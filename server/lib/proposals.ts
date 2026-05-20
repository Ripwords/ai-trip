import { z } from "zod"

const aiActivityPayloadSchema = z.object({
  name: z.string(),
  type: z.string(),
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

import { randomUUID } from "node:crypto"
import type { AIProcessResult } from "./ai"

export interface DayForProposals {
  id: string
  activities: { id: string; name: string }[]
}

function findActivityIdByName(
  day: DayForProposals,
  name: string,
): string | undefined {
  const normalized = name.toLowerCase().trim()
  return day.activities.find((a) => a.name.toLowerCase().trim() === normalized)?.id
}

function describeActivities(activities: { name: string; suggestedTime?: string }[]): string {
  const head = activities[0]
  if (!head) return ""
  if (activities.length === 1) {
    return head.suggestedTime ? `${head.name} at ${head.suggestedTime}` : head.name
  }
  return `${head.name} and ${activities.length - 1} more`
}

export function resultToProposals(
  result: AIProcessResult,
  day: DayForProposals,
): Proposal[] {
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
