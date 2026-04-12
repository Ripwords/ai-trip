import { and, eq, desc, sql } from "drizzle-orm"
import { db } from "../../../../db"
import { itineraryDays, activities } from "../../../../db/schema"
import { uuidParamsSchema, addActivitySchema } from "../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../lib/segments"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, addActivitySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify itineraryDayId belongs to trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, body.itineraryDayId), eq(itineraryDays.tripId, id)),
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  // Check per-day activity limit
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activities)
    .where(eq(activities.itineraryDayId, body.itineraryDayId))
  if (count >= 30) {
    throw createError({
      statusCode: 400,
      message: "Maximum number of activities per day reached (30)",
    })
  }

  // Get max sortOrder for that day
  const lastActivity = await db.query.activities.findFirst({
    where: eq(activities.itineraryDayId, body.itineraryDayId),
    orderBy: [desc(activities.sortOrder)],
  })
  const sortOrder = (lastActivity?.sortOrder ?? -1) + 1

  const { itineraryDayId, rating, ...rest } = body

  const [activity] = await db
    .insert(activities)
    .values({
      ...rest,
      itineraryDayId,
      sortOrder,
      rating: rating != null ? String(rating) : undefined,
    })
    .returning()

  // Recompute segments
  await computeAndSaveSegments(itineraryDayId)

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "activity_added",
    description: `Added "${activity!.name}" to Day`,
  })

  return activity
})
