import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { activities, itineraryDays } from "../db/schema"
import { enrichItinerary } from "./enrich"
import { computeAndSaveSegments } from "./segments"
import { getDistanceMatrix } from "./google-maps"
import { computeSchedule, parseOpeningTime } from "../utils/schedule"
import { logTripAction } from "../utils/trip-access"
import type { TransportMode } from "../utils/transport"
import type { AIProcessResult } from "./ai"

const aiActivityPayloadSchema = z.object({
  name: z.string(),
  type: z.enum([
    "attraction",
    "restaurant",
    "hotel",
    "transport",
    "shopping",
    "entertainment",
    "museum",
    "park",
    "cafe",
    "bar",
    "spa",
  ]),
  description: z.string(),
  suggestedTime: z.string(),
  estimatedDurationMinutes: z.number().int().positive(),
  costEstimate: z.number().min(0),
  tags: z.array(z.string()),
  // Optional enrichment fields — present when the agent has already resolved a place.
  placeId: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
})

const baseProposal = z.object({
  id: z.string().uuid(),
  dayId: z.string().uuid(),
  summary: z.string().min(1),
})

export const proposalSchema = z.discriminatedUnion("kind", [
  baseProposal.extend({
    kind: z.literal("add-activities"),
    payload: z.object({ activities: z.array(aiActivityPayloadSchema).min(1) }),
  }),
  baseProposal.extend({
    kind: z.literal("remove-activities"),
    payload: z.object({ activityIds: z.array(z.string().uuid()).min(1) }),
  }),
  baseProposal.extend({
    kind: z.literal("reschedule"),
    payload: z.object({
      updates: z
        .array(
          z.object({
            activityId: z.string().uuid(),
            suggestedTime: z.string().regex(/^\d{2}:\d{2}$/),
            estimatedDurationMinutes: z.number().int().positive(),
          }),
        )
        .min(1),
    }),
  }),
  baseProposal.extend({
    kind: z.literal("optimize-route"),
    payload: z.object({ orderedActivityIds: z.array(z.string().uuid()).optional() }),
  }),
  baseProposal.extend({
    kind: z.literal("reorder-activities"),
    payload: z.object({
      orderedActivityIds: z.array(z.string().uuid()).min(1),
    }),
  }),
  baseProposal.extend({
    kind: z.literal("set-accommodation"),
    payload: z.object({
      name: z.string(),
      address: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      placeId: z.string().nullable(),
    }),
  }),
])

export type Proposal = z.infer<typeof proposalSchema>
export type ProposalKind = Proposal["kind"]

export interface DayForProposals {
  id: string
  activities: { id: string; name: string }[]
}

function findActivityIdByName(day: DayForProposals, name: string): string | undefined {
  const normalized = name.toLowerCase().trim()
  return day.activities.find((a) => a.name.toLowerCase().trim() === normalized)?.id
}

function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const m = time.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10)
}

/**
 * Slot newly-inserted activities into the day's existing sequence by their
 * suggestedTime, without disturbing the relative order of existing activities.
 * Each new row is placed before the first existing row with a later time
 * (or at the end if no time / no later existing time).
 */
async function slotNewActivitiesIntoSequence(
  dayId: string,
  existing: { id: string; suggestedTime: string | null; sortOrder: number }[],
  inserted: { id: string; suggestedTime: string | null }[],
): Promise<void> {
  const existingSorted = existing.toSorted((a, b) => a.sortOrder - b.sortOrder)
  const merged: { id: string }[] = existingSorted.map((e) => ({ id: e.id }))
  const existingTimes = existingSorted.map((e) => timeToMinutes(e.suggestedTime))

  for (const newRow of inserted) {
    const newMin = timeToMinutes(newRow.suggestedTime)
    let insertAt = merged.length
    if (newMin != null) {
      const idx = existingTimes.findIndex((t) => t != null && t > newMin)
      if (idx >= 0) {
        // Find the corresponding position in the merged array (may have shifted
        // as earlier new rows were inserted).
        const anchorId = existingSorted[idx]!.id
        insertAt = merged.findIndex((m) => m.id === anchorId)
        if (insertAt === -1) insertAt = merged.length
      }
    }
    merged.splice(insertAt, 0, { id: newRow.id })
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < merged.length; i++) {
      await tx
        .update(activities)
        .set({ sortOrder: i })
        .where(and(eq(activities.id, merged[i]!.id), eq(activities.itineraryDayId, dayId)))
    }
  })
}

function describeActivities(activities: { name: string; suggestedTime?: string }[]): string {
  const head = activities[0]
  if (!head) return ""
  if (activities.length === 1) {
    return head.suggestedTime ? `${head.name} at ${head.suggestedTime}` : head.name
  }
  return `${head.name} and ${activities.length - 1} more`
}

export interface ApplyContext {
  tripId: string
  dayId: string
  userId: string
  transportMode: TransportMode
  /** Optional bias for enrichment when adding activities. */
  dayLocation?: string
  /** Optional coordinates for place-search bias during enrichment. */
  destinationCoords?: { lat: number; lng: number }
  /** Optional previous-day accommodation used by optimize. */
  startLocation?: { lat: number | null; lng: number | null } | null
}

export interface ApplyResult {
  message: string
  added: number
  removed: number
  updated: number
  optimized: boolean
  enrichmentFailures: number
}

export async function applyProposal(proposal: Proposal, ctx: ApplyContext): Promise<ApplyResult> {
  if (proposal.dayId !== ctx.dayId) {
    throw createError({ statusCode: 400, message: "Proposal dayId mismatch with route" })
  }

  let added = 0
  let removed = 0
  let updated = 0
  let optimized = false
  let enrichmentFailures = 0
  let message = ""

  switch (proposal.kind) {
    case "remove-activities": {
      const deleteResult = await db
        .delete(activities)
        .where(
          and(
            eq(activities.itineraryDayId, ctx.dayId),
            inArray(activities.id, proposal.payload.activityIds),
          ),
        )
        .returning({ id: activities.id })
      removed = deleteResult.length
      message = `Removed ${removed} activit${removed === 1 ? "y" : "ies"}`
      break
    }

    case "reschedule": {
      const results = await Promise.all(
        proposal.payload.updates.map((u) =>
          db
            .update(activities)
            .set({
              suggestedTime: u.suggestedTime,
              estimatedDurationMinutes: u.estimatedDurationMinutes,
            })
            .where(and(eq(activities.id, u.activityId), eq(activities.itineraryDayId, ctx.dayId)))
            .returning({ id: activities.id }),
        ),
      )
      updated = results.reduce((sum, r) => sum + r.length, 0)
      message = `Rescheduled ${updated} activit${updated === 1 ? "y" : "ies"}`
      break
    }

    case "add-activities": {
      try {
        const enriched = await enrichItinerary(
          {
            days: [{ dayNumber: 0, theme: "", activities: proposal.payload.activities }],
          },
          ctx.dayLocation ?? "",
          ctx.destinationCoords,
        )
        enrichmentFailures = enriched.enrichmentFailures
        const enrichedActivities = enriched.days[0]?.activities ?? []
        if (enrichedActivities.length > 0) {
          const current = await db.query.activities.findMany({
            where: eq(activities.itineraryDayId, ctx.dayId),
            orderBy: [asc(activities.sortOrder)],
          })
          const maxSort = current.length > 0 ? Math.max(...current.map((a) => a.sortOrder)) : -1
          const inserted = await db
            .insert(activities)
            .values(
              enrichedActivities.map((a, i) => ({
                itineraryDayId: ctx.dayId,
                name: a.name,
                placeId: a.placeId,
                type: a.type,
                description: a.description,
                lat: a.lat,
                lng: a.lng,
                address: a.address,
                rating: a.rating?.toString() ?? null,
                priceLevel: a.priceLevel,
                openingHours: a.openingHours,
                photos: a.photos,
                suggestedTime: a.suggestedTime,
                estimatedDurationMinutes: a.estimatedDurationMinutes,
                costEstimate: a.costEstimate.toString(),
                tags: a.tags,
                sortOrder: maxSort + 1 + i,
              })),
            )
            .returning({
              id: activities.id,
              suggestedTime: activities.suggestedTime,
              sortOrder: activities.sortOrder,
            })
          added = inserted.length

          // Slot new activities into the day's sequence by suggestedTime.
          // Preserves existing relative order (so manual reorders aren't stomped).
          await slotNewActivitiesIntoSequence(
            ctx.dayId,
            current.map((a) => ({
              id: a.id,
              suggestedTime: a.suggestedTime,
              sortOrder: a.sortOrder,
            })),
            inserted,
          )
        }
      } catch (e) {
        console.error("[applyProposal] enrichment failed:", e)
        // Re-throw so the apply endpoint surfaces an error to the client
        // instead of silently flipping the proposal card to "Applied" with
        // 0 activities added.
        if (added === 0) {
          throw createError({
            statusCode: 502,
            message: "Couldn't enrich the activity with Google Maps data. Please try again.",
          })
        }
      }
      message = `Added ${added} activit${added === 1 ? "y" : "ies"}`
      break
    }

    case "reorder-activities": {
      const dayActivities = await db.query.activities.findMany({
        where: eq(activities.itineraryDayId, ctx.dayId),
        orderBy: [asc(activities.sortOrder)],
      })
      const knownIds = new Set(dayActivities.map((a) => a.id))
      const orderedIds = proposal.payload.orderedActivityIds.filter((id) => knownIds.has(id))
      const remaining = dayActivities.filter((a) => !orderedIds.includes(a.id))
      const finalOrder = [...orderedIds, ...remaining.map((a) => a.id)]

      await db.transaction(async (tx) => {
        for (let i = 0; i < finalOrder.length; i++) {
          await tx
            .update(activities)
            .set({ sortOrder: i })
            .where(and(eq(activities.id, finalOrder[i]!), eq(activities.itineraryDayId, ctx.dayId)))
        }
      })
      updated = orderedIds.length
      message = `Reordered ${updated} activit${updated === 1 ? "y" : "ies"}`
      break
    }

    case "optimize-route": {
      const dayActivities = await db.query.activities.findMany({
        where: eq(activities.itineraryDayId, ctx.dayId),
        orderBy: [asc(activities.sortOrder)],
      })
      if (dayActivities.length >= 2) {
        if (proposal.payload.orderedActivityIds?.length) {
          const ids = proposal.payload.orderedActivityIds
          await db.transaction(async (tx) => {
            for (let i = 0; i < ids.length; i++) {
              await tx
                .update(activities)
                .set({ sortOrder: i })
                .where(and(eq(activities.id, ids[i]!), eq(activities.itineraryDayId, ctx.dayId)))
            }
          })
          optimized = true
        } else {
          const day = await db.query.itineraryDays.findFirst({
            where: eq(itineraryDays.id, ctx.dayId),
          })
          if (!day) throw createError({ statusCode: 404, message: "Day not found" })

          const geo = dayActivities.filter((a) => a.lat != null && a.lng != null)
          const travelTimes: { fromId: string; toId: string; durationMinutes: number }[] = []
          if (geo.length >= 2) {
            try {
              const origins = geo.slice(0, -1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
              const destinations = geo.slice(1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
              const matrix = await getDistanceMatrix(origins, destinations, ctx.transportMode)
              for (let i = 0; i < origins.length; i++) {
                const el = matrix[i]?.[i]
                if (el?.duration?.value) {
                  travelTimes.push({
                    fromId: geo[i]!.id,
                    toId: geo[i + 1]!.id,
                    durationMinutes: Math.ceil(el.duration.value / 60),
                  })
                }
              }
            } catch {
              /* proceed without travel times */
            }
          }

          const schedule = computeSchedule({
            activities: dayActivities.map((a) => ({
              id: a.id,
              name: a.name,
              estimatedDurationMinutes: a.estimatedDurationMinutes,
              lat: a.lat,
              lng: a.lng,
              openingMinutes: parseOpeningTime(a.openingHours, day.date),
            })),
            travelTimes,
            startHour: 9,
            startMinute: 0,
            startTravelTimeMinutes: 0,
            bufferMinutes: 15,
          })
          await db.transaction(async (tx) => {
            for (const s of schedule) {
              await tx
                .update(activities)
                .set({ sortOrder: s.sortOrder, suggestedTime: s.suggestedTime })
                .where(and(eq(activities.id, s.id), eq(activities.itineraryDayId, ctx.dayId)))
            }
          })
          optimized = true
        }
      }
      message = optimized ? "Optimized route" : "Nothing to optimize"
      break
    }

    case "set-accommodation": {
      await db
        .update(itineraryDays)
        .set({
          accommodationName: proposal.payload.name,
          accommodationAddress: proposal.payload.address,
          accommodationLat: proposal.payload.lat,
          accommodationLng: proposal.payload.lng,
          accommodationPlaceId: proposal.payload.placeId,
        })
        .where(eq(itineraryDays.id, ctx.dayId))
      message = `Set accommodation to ${proposal.payload.name}`
      break
    }
  }

  // If the proposal targets activities but matched nothing, surface that
  // instead of silently flipping the UI to "Applied".
  if (
    (proposal.kind === "remove-activities" && removed === 0) ||
    (proposal.kind === "reschedule" && updated === 0) ||
    (proposal.kind === "reorder-activities" && updated === 0)
  ) {
    throw createError({
      statusCode: 409,
      message:
        "This proposal references activities that no longer exist on the day. The schedule may have changed since it was suggested — refresh and try again.",
    })
  }

  // Recompute segments after any mutation that changed activities or accommodation.
  await computeAndSaveSegments(ctx.dayId, ctx.transportMode)

  await logTripAction({
    tripId: ctx.tripId,
    userId: ctx.userId,
    action: "ai_proposal_apply",
    description: `Applied proposal: ${proposal.summary}`,
    metadata: {
      proposalKind: proposal.kind,
      added,
      removed,
      updated,
      optimized,
    },
  })

  return { message, added, removed, updated, optimized, enrichmentFailures }
}

export function resultToProposals(result: AIProcessResult, day: DayForProposals): Proposal[] {
  const proposals: Proposal[] = []

  if (result.newActivities.length > 0) {
    proposals.push({
      id: randomUUID(),
      kind: "add-activities",
      dayId: day.id,
      summary: `Add ${describeActivities(result.newActivities)}`,
      payload: { activities: result.newActivities },
    })
  }

  if (result.removals.length > 0) {
    const activityIds = result.removals
      .map((r) => findActivityIdByName(day, r.name))
      .filter((id): id is string => !!id)
    if (activityIds.length > 0) {
      const names = result.removals
        .filter((r) => findActivityIdByName(day, r.name))
        .map((r) => r.name)
      proposals.push({
        id: randomUUID(),
        kind: "remove-activities",
        dayId: day.id,
        summary: `Remove ${names.join(", ")}`,
        payload: { activityIds },
      })
    }
  }

  if (result.updates.length > 0) {
    const updates = result.updates
      .map((u) => {
        const activityId = findActivityIdByName(day, u.name)
        if (!activityId) return null
        return {
          activityId,
          suggestedTime: u.suggestedTime,
          estimatedDurationMinutes: u.estimatedDurationMinutes,
        }
      })
      .filter((u): u is NonNullable<typeof u> => u !== null)
    if (updates.length > 0) {
      proposals.push({
        id: randomUUID(),
        kind: "reschedule",
        dayId: day.id,
        summary: `Reschedule ${updates.length} activit${updates.length === 1 ? "y" : "ies"}`,
        payload: { updates },
      })
    }
  }

  if (result.shouldOptimize && result.newActivities.length === 0 && result.removals.length === 0) {
    const orderedActivityIds = result.orderedActivities
      ?.map((o) => findActivityIdByName(day, o.name))
      .filter((id): id is string => !!id)
    proposals.push({
      id: randomUUID(),
      kind: "optimize-route",
      dayId: day.id,
      summary: "Optimize route for the day",
      payload: orderedActivityIds?.length ? { orderedActivityIds } : {},
    })
  }

  if (result.accommodation) {
    proposals.push({
      id: randomUUID(),
      kind: "set-accommodation",
      dayId: day.id,
      summary: `Set accommodation to ${result.accommodation.name}`,
      payload: result.accommodation,
    })
  }

  return proposals
}
