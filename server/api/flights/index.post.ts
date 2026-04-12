import { db } from "../../db"
import { flights } from "../../db/schema"
import { createFlightSchema } from "../../utils/schemas"
import { lookupFlight } from "../../lib/flight-api"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createFlightSchema.parse)

  // If tripId provided, verify user has access to that trip
  if (body.tripId) {
    await requireTripAccess(body.tripId, session.user.id)
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
      departureTime: flightData?.departureTime ?? null,
      arrivalTime: flightData?.arrivalTime ?? null,
      terminal: flightData?.terminal ?? null,
      gate: flightData?.gate ?? null,
      status: flightData?.status ?? "scheduled",
      rawApiResponse: flightData?.rawApiResponse ?? null,
      apiLastFetchedAt: flightData ? new Date() : null,
    })
    .returning()

  return flight
})
