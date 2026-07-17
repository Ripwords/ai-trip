import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { createTool } from "@mastra/core/tools"
import { db } from "../db"
import { activities, itineraryDays } from "../db/schema"
import { searchPlace, getPlaceDetails, getDistanceMatrix } from "./google-maps"
import { reviewItinerary, type ReviewableFlight } from "./itinerary-review"
import { getTripFlightsForUser } from "./trip-flights"
import { getTripWithRelations } from "./trips"
import { proposalSchema, type Proposal } from "./proposals"
import { resolveTargetDay, resolveTargetDays, type DayRef } from "./proposal-targeting"
import type { TransportMode } from "../utils/transport"
import { costAnchorHint } from "./currency-context"

async function validateActivityIds(
  dayId: string,
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    columns: { id: true, name: true },
  })
  const known = new Set(rows.map((r) => r.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    const knownList = rows.map((r) => `[${r.id}] ${r.name}`).join("; ")
    return {
      ok: false,
      error: `Unknown activity ids: ${unknown.join(", ")}. Pick from the bracketed ids in the trip context. Known activities for this day: ${knownList || "(none)"}`,
    }
  }
  return { ok: true }
}

export interface TripToolsContext {
  tripId: string
  activeDayId: string
  days: DayRef[]
  transportMode: TransportMode
  currencyCode: string
}

export function createTripTools(ctx: TripToolsContext) {
  const searchPlaces = createTool({
    id: "searchPlaces",
    description:
      "Search Google Places for a venue by name and city. Returns up to 5 candidates with lat/lng and address. Use this to verify a place exists before recommending it. (Use getPlaceDetails afterwards if you need rating, hours, or price level.)",
    inputSchema: z.object({
      query: z.string().describe("Place name plus city, e.g. 'Afuri Ramen Roppongi Tokyo'"),
      near: z
        .object({ lat: z.number(), lng: z.number() })
        .optional()
        .describe("Optional bias point for the search"),
    }),
    execute: async (input) => {
      const biased = input.near
        ? `${input.query} near ${input.near.lat},${input.near.lng}`
        : input.query
      const candidates = await searchPlace(biased)
      return {
        candidates: candidates.slice(0, 5).map((c) => ({
          name: c.name,
          placeId: c.placeId,
          address: c.formattedAddress ?? null,
          lat: c.lat,
          lng: c.lng,
        })),
      }
    },
  })

  const getPlaceDetailsTool = createTool({
    id: "getPlaceDetails",
    description:
      "Get opening hours, rating, price level, and photos for a Google Place by placeId.",
    inputSchema: z.object({ placeId: z.string() }),
    execute: async (input) => {
      const details = await getPlaceDetails(input.placeId)
      if (!details) return { found: false }
      return { found: true, details }
    },
  })

  const getDistance = createTool({
    id: "getDistance",
    description:
      "Get travel time and distance between two coordinates using the configured transport mode. Returns duration in seconds and distance in meters (plus human-readable text fields).",
    inputSchema: z.object({
      from: z.object({ lat: z.number(), lng: z.number() }),
      to: z.object({ lat: z.number(), lng: z.number() }),
    }),
    execute: async (input) => {
      const matrix = await getDistanceMatrix([input.from], [input.to], ctx.transportMode)
      const el = matrix[0]?.[0]
      if (!el || el.status !== "OK") return { ok: false }
      return {
        ok: true,
        durationSeconds: el.duration?.value ?? null,
        distanceMeters: el.distance?.value ?? null,
        durationText: el.duration?.text ?? null,
        distanceText: el.distance?.text ?? null,
      }
    },
  })

  const readDay = createTool({
    id: "readDay",
    description:
      "Read the current activities, accommodation, and travel segments for the day in scope.",
    inputSchema: z.object({}),
    execute: async () => {
      const day = await db.query.itineraryDays.findFirst({
        where: eq(itineraryDays.id, ctx.activeDayId),
        with: {
          activities: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
          travelSegments: true,
        },
      })
      return day ?? { error: "day not found" }
    },
  })

  const readTripSummary = createTool({
    id: "readTripSummary",
    description:
      "Read a trimmed view of the entire trip: destination, dates, preferences, and per-day activity names, times, and coordinates.",
    inputSchema: z.object({}),
    execute: async () => {
      const trip = await getTripWithRelations(ctx.tripId)
      if (!trip) return { error: "trip not found" }
      return summarizeTripForAgent(trip)
    },
  })

  const runReview = createTool({
    id: "runReview",
    description:
      "Run the deterministic itinerary review for the current trip. Returns critical/warning/suggestion findings (missing data, overlaps, travel-time blowouts, etc.). For the discuss agent: call this when the user explicitly asks 'what's wrong with my day/trip?'. For the reviewer agent: do NOT call — the deterministic findings are already injected into your prompt.",
    inputSchema: z.object({
      scope: z.enum(["day", "trip"]),
    }),
    execute: async (input) => {
      const trip = await getTripWithRelations(ctx.tripId)
      if (!trip) return { error: "trip not found" }
      // Flight bounds make arrival/departure-day findings possible. User-scoped;
      // degrades to no flight findings when unavailable.
      let flights: ReviewableFlight[] = []
      if (ctx.userId) {
        try {
          const rows = await getTripFlightsForUser({ tripId: ctx.tripId, userId: ctx.userId })
          flights = rows.map((f) => ({
            departureAirport: f.departureAirport,
            arrivalAirport: f.arrivalAirport,
            departureTimeLocal: f.departureTimeLocal,
            arrivalTimeLocal: f.arrivalTimeLocal,
          }))
        } catch (e: unknown) {
          console.error("[runReview] Flight context unavailable, proceeding without:", e)
        }
      }
      return reviewItinerary(
        { ...trip, flights },
        input.scope === "trip"
          ? { scope: input.scope }
          : { scope: input.scope, dayId: ctx.activeDayId },
      )
    },
  })

  return {
    searchPlaces,
    getPlaceDetails: getPlaceDetailsTool,
    getDistance,
    readDay,
    readTripSummary,
    runReview,
  }
}

/**
 * Trimmed trip view for agent tools. Keeps lat/lng per activity — the discuss
 * ROUTE CHECK needs locations for days other than the open one (readDay covers
 * the open day with full rows), and getDistance is unusable without coords.
 */
export function summarizeTripForAgent(trip: {
  destination: string
  startDate: string
  endDate: string
  preferences: unknown
  days: {
    id: string
    dayNumber: number
    date: string
    accommodationName: string | null
    activities: {
      name: string
      type: string
      suggestedTime: string | null
      estimatedDurationMinutes: number | null
      lat: number | null
      lng: number | null
    }[]
  }[]
}) {
  return {
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    preferences: trip.preferences,
    days: trip.days.map((d) => ({
      id: d.id,
      dayNumber: d.dayNumber,
      date: d.date,
      accommodation: d.accommodationName,
      activities: d.activities.map((a) => ({
        name: a.name,
        type: a.type,
        time: a.suggestedTime,
        duration: a.estimatedDurationMinutes,
        lat: a.lat,
        lng: a.lng,
      })),
    })),
  }
}

interface DiscussToolsContext extends TripToolsContext {
  /** Live USD→trip-currency rate for cost anchors; null degrades to static hints. */
  usdRate: number | null
  /** Flights are user-scoped — needed so runReview can include flight findings. */
  userId?: string
}

export function createDiscussTools(ctx: DiscussToolsContext, collector: Proposal[]) {
  const trip = createTripTools(ctx)

  const webSearch = createTool({
    id: "webSearch",
    description:
      "Search the web for real-world information: events, weather, current opening status, comparisons of named venues, festivals, holidays. Provide a single search query string.",
    inputSchema: z.object({
      query: z.string().describe("A single web search query string."),
    }),
    execute: async (inputData) => {
      const { google: gp } = await import("@ai-sdk/google")
      const { generateText, stepCountIs } = await import("ai")
      const searchQuery = inputData.query
      if (!searchQuery) return { results: "" }
      try {
        const { text } = await generateText({
          model: gp("gemini-3.1-flash-lite"),
          tools: { google_search: gp.tools.googleSearch({ searchTypes: { webSearch: {} } }) },
          stopWhen: stepCountIs(3),
          prompt: searchQuery,
        })
        return { results: text }
      } catch (e) {
        return { results: "", error: String(e) }
      }
    },
  })

  const proposeAddActivities = createTool({
    id: "proposeAddActivities",
    description: `Suggest adding one or more activities to the target day. Defaults to the open day; pass \`dayId\` (a \`[day:…]\` id from the trip context) to target another day, or \`dayIds\` to add the same thing to several days (one card per day). ONLY use after verifying the place via searchPlaces. All costEstimate values MUST be in the trip currency (${ctx.currencyCode}) — do NOT convert to USD.`,
    inputSchema: z.object({
      summary: z.string().min(1),
      dayId: z.string().uuid().optional(),
      dayIds: z.array(z.string().uuid()).min(1).optional(),
      activities: z.array(
        z.object({
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
          suggestedTime: z.string().regex(/^\d{2}:\d{2}$/),
          estimatedDurationMinutes: z
            .number()
            .int()
            .positive()
            .describe("Time spent AT the venue only; never includes travel time."),
          costEstimate: z.number().min(0).describe(costAnchorHint(ctx.currencyCode, ctx.usdRate)),
          tags: z.array(z.string()),
          placeId: z.string().nullable().optional(),
          lat: z.number().nullable().optional(),
          lng: z.number().nullable().optional(),
          address: z.string().nullable().optional(),
        }),
      ),
    }),
    execute: async (input) => {
      const targets = resolveTargetDays(ctx.days, ctx.activeDayId, {
        dayId: input.dayId,
        dayIds: input.dayIds,
      })
      if (!targets.ok) return { ok: false, error: targets.error }
      for (const dayId of targets.dayIds) {
        const proposal: Proposal = {
          id: randomUUID(),
          kind: "add-activities",
          dayId,
          summary: input.summary,
          payload: { activities: input.activities },
        }
        const validated = proposalSchema.safeParse(proposal)
        if (!validated.success) return { ok: false, error: validated.error.message }
        collector.push(validated.data)
      }
      return { ok: true }
    },
  })

  const proposeRemoveActivities = createTool({
    id: "proposeRemoveActivities",
    description:
      "Suggest removing one or more activities from a day. Pass the bracketed ids from the trip context. Defaults to the open day; pass `dayId` to target another.",
    inputSchema: z.object({
      summary: z.string().min(1),
      activityIds: z.array(z.string()).min(1),
      dayId: z.string().uuid().optional(),
    }),
    execute: async (input) => {
      const target = resolveTargetDay(ctx.days, ctx.activeDayId, input.dayId)
      if (!target.ok) return { ok: false, error: target.error }
      const idCheck = await validateActivityIds(target.dayId, input.activityIds)
      if (!idCheck.ok) return idCheck
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "remove-activities",
        dayId: target.dayId,
        summary: input.summary,
        payload: { activityIds: input.activityIds },
      }
      const validated = proposalSchema.safeParse(proposal)
      if (!validated.success) return { ok: false, error: validated.error.message }
      collector.push(validated.data)
      return { ok: true }
    },
  })

  const proposeReschedule = createTool({
    id: "proposeReschedule",
    description:
      "Change the start time and/or duration of activities on a day. Pass the bracketed ids from the trip context. estimatedDurationMinutes is activity-only and never includes travel time. Defaults to the open day; pass `dayId` to target another.",
    inputSchema: z.object({
      summary: z.string().min(1),
      updates: z.array(
        z.object({
          activityId: z.string(),
          suggestedTime: z.string().describe("HH:MM"),
          estimatedDurationMinutes: z.number().int().positive(),
        }),
      ),
      dayId: z.string().uuid().optional(),
    }),
    execute: async (input) => {
      const target = resolveTargetDay(ctx.days, ctx.activeDayId, input.dayId)
      if (!target.ok) return { ok: false, error: target.error }
      const idCheck = await validateActivityIds(
        target.dayId,
        input.updates.map((u) => u.activityId),
      )
      if (!idCheck.ok) return idCheck
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "reschedule",
        dayId: target.dayId,
        summary: input.summary,
        payload: { updates: input.updates },
      }
      const validated = proposalSchema.safeParse(proposal)
      if (!validated.success) return { ok: false, error: validated.error.message }
      collector.push(validated.data)
      return { ok: true }
    },
  })

  const proposeReorder = createTool({
    id: "proposeReorder",
    description:
      "Reorder existing activities on a day. orderedActivityIds is the new sequence using bracketed ids from the trip context. You can list a partial subset (those move to the front in the given order; unlisted activities keep their relative order behind them). Use this when the user wants to rearrange the sequence WITHOUT changing times (combine with proposeReschedule when both are needed). Defaults to the open day; pass `dayId` to target another.",
    inputSchema: z.object({
      summary: z.string().min(1),
      orderedActivityIds: z
        .array(z.string())
        .min(1)
        .describe("Activity ids in the new sequence (top of the day first)."),
      dayId: z.string().uuid().optional(),
    }),
    execute: async (input) => {
      const target = resolveTargetDay(ctx.days, ctx.activeDayId, input.dayId)
      if (!target.ok) return { ok: false, error: target.error }
      const idCheck = await validateActivityIds(target.dayId, input.orderedActivityIds)
      if (!idCheck.ok) return idCheck
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "reorder-activities",
        dayId: target.dayId,
        summary: input.summary,
        payload: { orderedActivityIds: input.orderedActivityIds },
      }
      const validated = proposalSchema.safeParse(proposal)
      if (!validated.success) return { ok: false, error: validated.error.message }
      collector.push(validated.data)
      return { ok: true }
    },
  })

  const proposeSetAccommodation = createTool({
    id: "proposeSetAccommodation",
    description:
      "Set or change accommodation for a day. Use searchPlaces to verify the venue first. Defaults to the open day; pass `dayId` to target another.",
    inputSchema: z.object({
      summary: z.string().min(1),
      name: z.string(),
      address: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      placeId: z.string().nullable(),
      dayId: z.string().uuid().optional(),
    }),
    execute: async (input) => {
      const target = resolveTargetDay(ctx.days, ctx.activeDayId, input.dayId)
      if (!target.ok) return { ok: false, error: target.error }
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "set-accommodation",
        dayId: target.dayId,
        summary: input.summary,
        payload: {
          name: input.name,
          address: input.address,
          lat: input.lat,
          lng: input.lng,
          placeId: input.placeId,
        },
      }
      const validated = proposalSchema.safeParse(proposal)
      if (!validated.success) return { ok: false, error: validated.error.message }
      collector.push(validated.data)
      return { ok: true }
    },
  })

  return {
    ...trip,
    webSearch,
    proposeAddActivities,
    proposeRemoveActivities,
    proposeReschedule,
    proposeReorder,
    proposeSetAccommodation,
  }
}
