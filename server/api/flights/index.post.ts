import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { createFlightSchema } from "../../utils/schemas"
import { lookupFlight, FLIGHT_LOOKUP_SCHEMA_VERSION } from "../../lib/flight-api"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createFlightSchema.parse)

  // If tripId provided, verify user has access to that trip
  if (body.tripId) {
    await requireTripAccess(body.tripId, session.user.id)
  }

  // One row per (user, flight number, date) — the unique index. Checked before
  // the paid AeroDataBox lookup; the insert below still guards the race.
  const duplicateMessage = `${body.flightNumber} on ${body.flightDate} is already in your flights.`
  const existing = await db.query.flights.findFirst({
    where: and(
      eq(flights.userId, session.user.id),
      eq(flights.flightNumber, body.flightNumber),
      eq(flights.flightDate, body.flightDate),
    ),
    columns: { id: true },
  })
  if (existing) {
    throw createError({ statusCode: 409, message: duplicateMessage })
  }

  // Look up flight data from AeroDataBox
  const flightData = await lookupFlight(body.flightNumber, body.flightDate)

  const [flight] = await db
    .insert(flights)
    .values({
      userId: session.user.id,
      flightNumber: body.flightNumber,
      flightDate: body.flightDate,
      tripId: body.tripId ?? null,
      airline: flightData?.airline ?? null,
      departureAirport: flightData?.departureAirport ?? null,
      arrivalAirport: flightData?.arrivalAirport ?? null,
      scheduledDepartureTime: flightData?.scheduledDepartureTime ?? null,
      actualDepartureTime: flightData?.actualDepartureTime ?? null,
      scheduledArrivalTime: flightData?.scheduledArrivalTime ?? null,
      actualArrivalTime: flightData?.actualArrivalTime ?? null,
      terminal: flightData?.terminal ?? null,
      gate: flightData?.gate ?? null,
      status: flightData?.status ?? "scheduled",
      rawApiResponse: flightData?.rawApiResponse ?? null,
      apiLastFetchedAt: flightData ? new Date() : null,
      lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
    })
    .onConflictDoNothing({
      target: [flights.userId, flights.flightNumber, flights.flightDate],
    })
    .returning()

  // A concurrent add of the same flight won between the check and the insert.
  if (!flight) {
    throw createError({ statusCode: 409, message: duplicateMessage })
  }

  return flight
})
