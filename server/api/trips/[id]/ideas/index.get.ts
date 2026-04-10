import { eq, asc } from "drizzle-orm"
import { db } from "../../../../db"
import { tripIdeas } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  return db.query.tripIdeas.findMany({
    where: eq(tripIdeas.tripId, id),
    orderBy: [asc(tripIdeas.sortOrder)],
  })
})
