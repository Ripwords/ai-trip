import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"
import { lookupFlight } from "../../lib/flight-api"

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

function shouldRefresh(flight: {
  apiLastFetchedAt: Date | null
  flightDate: string
  arrivalTime: Date | null
}): boolean {
  // Never fetched yet — refresh
  if (!flight.apiLastFetchedAt) return true

  // Flight in the past (>24h after arrival or flight date) — data is final
  const referenceTime = flight.arrivalTime ?? new Date(flight.flightDate + "T23:59:59Z")
  const oneDayAfter = new Date(referenceTime.getTime() + 24 * 60 * 60 * 1000)
  if (new Date() > oneDayAfter) return false

  // Refresh if last fetch is older than 2 hours
  return new Date().getTime() - flight.apiLastFetchedAt.getTime() > TWO_HOURS_MS
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
    with: { trip: { columns: { id: true, destination: true } } },
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  // Fresh-on-load: refresh if stale
  if (shouldRefresh(flight)) {
    const freshData = await lookupFlight(flight.flightNumber, flight.flightDate)
    if (freshData) {
      const [updated] = await db
        .update(flights)
        .set({
          airline: freshData.airline,
          departureAirport: freshData.departureAirport,
          arrivalAirport: freshData.arrivalAirport,
          departureTime: freshData.departureTime,
          arrivalTime: freshData.arrivalTime,
          terminal: freshData.terminal,
          gate: freshData.gate,
          status: freshData.status,
          rawApiResponse: freshData.rawApiResponse,
          apiLastFetchedAt: new Date(),
        })
        .where(eq(flights.id, id))
        .returning()

      return { ...updated, trip: flight.trip }
    }
  }

  return flight
})
