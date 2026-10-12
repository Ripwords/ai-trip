import "zod/compile"
import { eq, and, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { refreshDueFlights } from "../../lib/flight-refresh"

const querySchema = z.object({
  tripId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  const conditions: SQL[] = [eq(flights.userId, session.user.id)]
  if (query.tripId) {
    conditions.push(eq(flights.tripId, query.tripId))
  }

  const rows = await db.query.flights.findMany({
    where: and(...conditions),
    columns: { rawApiResponse: false },
    with: { trip: { columns: { id: true, destination: true } } },
    orderBy: (f, { asc }) => [asc(f.flightDate), asc(f.createdAt)],
  })
  // Flights near or in the air are looked up again so status, gate and actual
  // times move without anyone re-adding the flight. Bounded per request.
  return refreshDueFlights(rows)
})
