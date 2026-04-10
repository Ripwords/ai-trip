import { eq, asc } from "drizzle-orm"
import { db } from "../../../../db"
import { reservations } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  return db.query.reservations.findMany({
    where: eq(reservations.tripId, id),
    orderBy: [asc(reservations.startDate)],
  })
})
