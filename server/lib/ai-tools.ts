import { eq } from "drizzle-orm"
import { z } from "zod"
import { createTool } from "@mastra/core/tools"
import { db } from "../db"
import { itineraryDays } from "../db/schema"
import { searchPlace, getPlaceDetails, getDistanceMatrix } from "./google-maps"
import { reviewItinerary } from "./itinerary-review"
import { getTripWithRelations } from "./trips"
import type { TransportMode } from "../utils/transport"

export interface TripToolsContext {
  tripId: string
  dayId: string
  transportMode: TransportMode
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
