import "zod/compile"
import { eq, and, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { flights } from "../../db/schema"

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

  return db.query.flights.findMany({
    where: and(...conditions),
    columns: { rawApiResponse: false },
    with: { trip: { columns: { id: true, destination: true } } },
    orderBy: (f, { asc }) => [asc(f.flightDate), asc(f.createdAt)],
  })
})
