import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { createTool } from "@mastra/core/tools"
import { db } from "../db"
import { itineraryDays } from "../db/schema"
import { searchPlace, getPlaceDetails, getDistanceMatrix } from "./google-maps"
import { reviewItinerary } from "./itinerary-review"
import { getTripWithRelations } from "./trips"
import { proposalSchema, type Proposal } from "./proposals"
import type { TransportMode } from "../utils/transport"

export interface TripToolsContext {
  tripId: string
  dayId: string
  transportMode: TransportMode
  currencyCode: string
}

export function createTripTools(ctx: TripToolsContext) {
  const searchPlaces = createTool({
    id: "searchPlaces",
    description:
      "Search Google Places for a venue by name and city. Returns up to 5 candidates with lat/lng, address, rating. Use this to verify a place exists before recommending it.",
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
          rating: c.rating ?? null,
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
      "Get travel time and distance between two coordinates using the configured transport mode.",
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
        where: eq(itineraryDays.id, ctx.dayId),
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
      "Read a trimmed view of the entire trip: destination, dates, preferences, and per-day activity names + times.",
    inputSchema: z.object({}),
    execute: async () => {
      const trip = await getTripWithRelations(ctx.tripId)
      if (!trip) return { error: "trip not found" }
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
          })),
        })),
      }
    },
  })

  const runReview = createTool({
    id: "runReview",
    description:
      "Run the deterministic itinerary review for the current trip (returns critical/warning/suggestion findings). Use this BEFORE forming AI judgment findings.",
    inputSchema: z.object({
      scope: z.enum(["day", "trip"]),
    }),
    execute: async (input) => {
      const trip = await getTripWithRelations(ctx.tripId)
      if (!trip) return { error: "trip not found" }
      return reviewItinerary(
        trip,
        input.scope === "trip" ? { scope: input.scope } : { scope: input.scope, dayId: ctx.dayId },
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

interface DiscussToolsContext extends TripToolsContext {}

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
          model: gp("gemini-3.1-flash-lite-preview"),
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
    description: `Suggest adding one or more specific activities to a day. ONLY use when you have verified the place via search_places. Always include a clear summary and the day to add to. All costEstimate values MUST be expressed in the trip currency (${ctx.currencyCode}) — do NOT convert to USD.`,
    inputSchema: z.object({
      dayId: z.string().describe("Day uuid"),
      summary: z.string().min(1),
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
          costEstimate: z
            .number()
            .min(0)
            .describe(
              `Cost per visit in ${ctx.currencyCode}. Use whole units for zero-decimal currencies (JPY/KRW/VND/IDR/TWD).`,
            ),
          tags: z.array(z.string()),
          placeId: z.string().nullable().optional(),
          lat: z.number().nullable().optional(),
          lng: z.number().nullable().optional(),
          address: z.string().nullable().optional(),
        }),
      ),
    }),
    execute: async (input) => {
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "add-activities",
        dayId: input.dayId,
        summary: input.summary,
        payload: { activities: input.activities },
      }
      const validated = proposalSchema.safeParse(proposal)
      if (!validated.success) return { ok: false, error: validated.error.message }
      collector.push(validated.data)
      return { ok: true }
    },
  })

  const proposeRemoveActivities = createTool({
    id: "proposeRemoveActivities",
    description: "Suggest removing one or more activities from a day by their ids.",
    inputSchema: z.object({
      dayId: z.string(),
      summary: z.string().min(1),
      activityIds: z.array(z.string()).min(1),
    }),
    execute: async (input) => {
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "remove-activities",
        dayId: input.dayId,
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
      "Suggest changing the start time and/or duration of one or more activities. estimatedDurationMinutes is activity-only and never includes travel time.",
    inputSchema: z.object({
      dayId: z.string(),
      summary: z.string().min(1),
      updates: z.array(
        z.object({
          activityId: z.string(),
          suggestedTime: z.string().describe("HH:MM"),
          estimatedDurationMinutes: z.number().int().positive(),
        }),
      ),
    }),
    execute: async (input) => {
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "reschedule",
        dayId: input.dayId,
        summary: input.summary,
        payload: { updates: input.updates },
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
      "Suggest setting an accommodation for a specific day. Use search_places to verify the venue first.",
    inputSchema: z.object({
      dayId: z.string(),
      summary: z.string().min(1),
      name: z.string(),
      address: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      placeId: z.string().nullable(),
    }),
    execute: async (input) => {
      const proposal: Proposal = {
        id: randomUUID(),
        kind: "set-accommodation",
        dayId: input.dayId,
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
    proposeSetAccommodation,
  }
}
