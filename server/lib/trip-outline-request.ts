/**
 * Builds the trip-level outline for a whole trip.
 *
 * Extracted from `generate-outline.post.ts` so the generation-run endpoint
 * produces byte-identical outline input rather than a second, drifting copy of
 * the same context assembly.
 */

import { eq } from "drizzle-orm"
import { db } from "../db"
import { tripIdeas } from "../db/schema"
import { getTripWithRelations, loadPartySize } from "./trips"
import { getTripFlightsForUser } from "./trip-flights"
import { buildTripOutline, type TripOutline, type TripOutlineInput } from "./trip-outline"

type TripWithRelations = NonNullable<Awaited<ReturnType<typeof getTripWithRelations>>>

/**
 * Two empty days sharing a `dayNumber` would collapse in `buildTripOutline`'s
 * lookup Map and send a day's plan to the wrong day. `itinerary_days` has only
 * a non-unique index on (trip_id, day_number), so check rather than assume —
 * and check BEFORE any credit is spent.
 */
export function assertDistinctEmptyDayNumbers(trip: TripWithRelations): void {
  const emptyDayNumbers = trip.days.filter((d) => d.activities.length === 0).map((d) => d.dayNumber)
  if (new Set(emptyDayNumbers).size === emptyDayNumbers.length) return
  const duplicates = [
    ...new Set(emptyDayNumbers.filter((n, i) => emptyDayNumbers.indexOf(n) !== i)),
  ]
  console.error(
    `[outline] duplicate dayNumber(s) among empty days for trip ${trip.id}: ${duplicates.join(", ")}`,
  )
  throw createError({
    statusCode: 500,
    message: "This trip's days are in an inconsistent state. Please contact support.",
  })
}

export async function buildOutlineForTrip(
  trip: TripWithRelations,
  userId: string,
): Promise<TripOutline> {
  const sortedDays = trip.days.toSorted((a, b) => a.dayNumber - b.dayNumber)

  const savedIdeas = await db.query.tripIdeas.findMany({
    where: eq(tripIdeas.tripId, trip.id),
    columns: { name: true, type: true, description: true },
  })

  const flights = await getTripFlightsForUser({ tripId: trip.id, userId })

  const input: TripOutlineInput = {
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    preferences: trip.preferences ?? undefined,
    party: await loadPartySize(trip),
    tripNotes: trip.tripNotes,
    savedIdeas,
    days: sortedDays.map((d) => ({
      dayId: d.id,
      dayNumber: d.dayNumber,
      date: d.date,
      isEmpty: d.activities.length === 0,
      existingActivityNames: d.activities.map((a) => a.name),
      accommodationName: d.accommodationName,
    })),
    // Same shape the day-AI and discuss endpoints send — including the local
    // times, which buildFlightsCtx prefers over UTC.
    flights: flights.map((f) => ({
      departureAirport: f.departureAirport,
      arrivalAirport: f.arrivalAirport,
      departureTimeUtc: f.departureTime?.toISOString() ?? null,
      arrivalTimeUtc: f.arrivalTime?.toISOString() ?? null,
      departureTimeLocal: f.departureTimeLocal,
      arrivalTimeLocal: f.arrivalTimeLocal,
    })),
  }

  return buildTripOutline(input)
}
