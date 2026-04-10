import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { activities, activityComments } from "../../../../../db/schema"
import { activityIdParamsSchema } from "../../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, activityId } = await getValidatedRouterParams(event, activityIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: { day: true },
  })
  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" })
  }

  const comments = await db.query.activityComments.findMany({
    where: eq(activityComments.activityId, activityId),
    with: { user: { columns: { name: true, image: true } } },
    orderBy: (c, { asc }) => [asc(c.createdAt)],
  })

  return comments
})
