import "zod/compile"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { activities, activityComments } from "../../../../../db/schema"
import { activityIdParamsSchema } from "../../../../../utils/schemas"

const commentBodySchema = z.object({
  text: z.string().min(1).max(1000),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, activityId } = await getValidatedRouterParams(event, activityIdParamsSchema.parse)
  const body = await readValidatedBody(event, commentBodySchema.parse)

  await requireTripAccess(id, session.user.id)

  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: { day: true },
  })
  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" })
  }

  const [comment] = await db
    .insert(activityComments)
    .values({
      activityId,
      userId: session.user.id,
      text: body.text,
    })
    .returning()

  return comment
})
