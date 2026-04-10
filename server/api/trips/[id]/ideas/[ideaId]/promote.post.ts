import { and, eq, desc } from "drizzle-orm"
import { db } from "../../../../../db"
import { tripIdeas, itineraryDays, activities } from "../../../../../db/schema"
import { ideaIdParamsSchema, promoteIdeaSchema } from "../../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../../lib/segments"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, ideaId } = await getValidatedRouterParams(event, ideaIdParamsSchema.parse)
  const body = await readValidatedBody(event, promoteIdeaSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify idea belongs to trip
  const idea = await db.query.tripIdeas.findFirst({
    where: and(eq(tripIdeas.id, ideaId), eq(tripIdeas.tripId, id)),
  })

  if (!idea) {
    throw createError({ statusCode: 404, message: "Idea not found" })
  }

  // Verify itineraryDayId belongs to the same trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, body.itineraryDayId), eq(itineraryDays.tripId, id)),
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  // Get max sortOrder for that day's activities
  let sortOrder = body.sortOrder
  if (sortOrder == null) {
    const lastActivity = await db.query.activities.findFirst({
      where: eq(activities.itineraryDayId, body.itineraryDayId),
      orderBy: [desc(activities.sortOrder)],
    })
    sortOrder = (lastActivity?.sortOrder ?? -1) + 1
  }

  // Insert into activities copying fields from the idea
  const [activity] = await db
    .insert(activities)
    .values({
      itineraryDayId: body.itineraryDayId,
      name: idea.name,
      placeId: idea.placeId,
      type: idea.type,
      description: idea.description,
      lat: idea.lat,
      lng: idea.lng,
      address: idea.address,
      rating: idea.rating,
      photos: idea.photos,
      notes: idea.notes,
      sortOrder,
    })
    .returning()

  // Delete the idea
  await db.delete(tripIdeas).where(eq(tripIdeas.id, ideaId))

  // Recompute segments
  await computeAndSaveSegments(body.itineraryDayId)

  return activity
})
