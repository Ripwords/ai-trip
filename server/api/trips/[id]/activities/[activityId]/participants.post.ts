import { eq, and } from "drizzle-orm"
import { db } from "../../../../../db"
import { activities, activityParticipants, tripMembers, trips } from "../../../../../db/schema"
import { activityIdParamsSchema, addParticipantSchema } from "../../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, activityId } = await getValidatedRouterParams(event, activityIdParamsSchema.parse)
  const body = await readValidatedBody(event, addParticipantSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify activity belongs to this trip
  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: { day: true },
  })

  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" })
  }

  // Verify the target userId is a member of this trip (owner or active member)
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { userId: true },
  })
  if (trip?.userId !== body.userId) {
    const member = await db.query.tripMembers.findFirst({
      where: and(
        eq(tripMembers.tripId, id),
        eq(tripMembers.userId, body.userId),
        eq(tripMembers.status, "active"),
      ),
    })
    if (!member) {
      throw createError({ statusCode: 403, message: "User is not a member of this trip" })
    }
  }

  const [participant] = await db
    .insert(activityParticipants)
    .values({
      activityId,
      userId: body.userId,
    })
    .onConflictDoNothing()
    .returning()

  return participant ?? { activityId, userId: body.userId }
})
