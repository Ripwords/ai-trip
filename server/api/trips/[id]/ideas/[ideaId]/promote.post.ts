import { and, eq, desc, sql } from "drizzle-orm"
import { db } from "../../../../../db"
import { tripIdeas, itineraryDays, activities, trips } from "../../../../../db/schema"
import { ideaIdParamsSchema, promoteIdeaSchema } from "../../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../../lib/segments"
import { deriveCostFromPlace } from "../../../../../lib/cost-from-place"

/** Same cap as every other add-activity path. */
const MAX_ACTIVITIES_PER_DAY = 30

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

  // Auto-derive a default cost from Google's priceRange when the idea has
  // a placeId. Mirrors the manual-add endpoint so promoted ideas don't
  // silently end up with null costEstimate either. Done before the
  // transaction: it can call Google, and must not hold a row lock meanwhile.
  let costEstimate: string | null = null
  if (idea.placeId) {
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
    if (trip) {
      costEstimate = await deriveCostFromPlace(idea.placeId, trip.currencyCode || "USD")
    }
  }

  // Cap check, insert and idea delete in one transaction (B23). Locking the
  // day row serialises concurrent adds to it, so two promotes cannot both see
  // 29 activities; deleting the idea with RETURNING makes a second promote of
  // the same idea roll back its insert instead of duplicating the activity.
  const activity = await db.transaction(async (tx) => {
    await tx
      .select({ id: itineraryDays.id })
      .from(itineraryDays)
      .where(eq(itineraryDays.id, body.itineraryDayId))
      .for("update")

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(activities)
      .where(eq(activities.itineraryDayId, body.itineraryDayId))
    if (Number(countResult?.count ?? 0) >= MAX_ACTIVITIES_PER_DAY) {
      throw createError({
        statusCode: 400,
        message: `Maximum number of activities per day reached (${MAX_ACTIVITIES_PER_DAY})`,
      })
    }

    let sortOrder = body.sortOrder
    if (sortOrder == null) {
      const lastActivity = await tx.query.activities.findFirst({
        where: eq(activities.itineraryDayId, body.itineraryDayId),
        orderBy: [desc(activities.sortOrder)],
      })
      sortOrder = (lastActivity?.sortOrder ?? -1) + 1
    }

    const [inserted] = await tx
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
        costEstimate,
        sortOrder,
      })
      .returning()

    const removed = await tx
      .delete(tripIdeas)
      .where(and(eq(tripIdeas.id, ideaId), eq(tripIdeas.tripId, id)))
      .returning({ id: tripIdeas.id })
    if (removed.length === 0) {
      throw createError({
        statusCode: 409,
        message: "This idea was already added to the itinerary",
      })
    }

    return inserted
  })

  // Recompute segments
  await computeAndSaveSegments(body.itineraryDayId)

  return activity
})
