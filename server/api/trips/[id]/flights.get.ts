import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { flights, trips, tripMembers } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  // Verify trip access (owner or member)
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  if (trip.userId !== session.user.id) {
    const membership = await db.query.tripMembers.findFirst({
      where: and(eq(tripMembers.tripId, id), eq(tripMembers.userId, session.user.id)),
    })
    if (!membership) {
      throw createError({ statusCode: 403, message: "Not authorized" })
    }
  }

  return db.query.flights.findMany({
    where: eq(flights.tripId, id),
    orderBy: (f, { asc, sql }) => [
      asc(f.flightDate),
      sql`${f.departureTime} ASC NULLS LAST`,
    ],
  })
})
