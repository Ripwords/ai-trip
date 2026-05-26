import { and, eq, desc, sql } from "drizzle-orm"
import { db } from "../../../../db"
import { itineraryDays, activities, travelSegments, trips } from "../../../../db/schema"
import { uuidParamsSchema, addActivitySchema } from "../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../lib/segments"
import { deriveCostFromPlace } from "../../../../lib/cost-from-place"
import { getPlaceDetails } from "../../../../lib/google-maps"

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

  const { itineraryDayId, rating, costEstimate: clientCostEstimate, ...rest } = body

  // Auto-derive a default cost from Google's priceRange when the client
  // didn't provide one and we have a placeId to look up. This is what
  // surfaces in Google Maps as "Around $X" and gives manually-added
  // activities a real starting estimate instead of a silent null.
  let costEstimate: string | null = clientCostEstimate ?? null
  if (!costEstimate && body.placeId) {
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
    if (trip) {
      costEstimate = await deriveCostFromPlace(body.placeId, trip.currencyCode || "USD")
    }
  }

  // Backfill rating / openingHours / priceLevel from Place Details
  // when the client didn't pre-populate them. Text Search no longer
  // returns rating (cost optimization), so this is the single place
  // those fields get attached for manually-added activities.
  let resolvedRating: string | undefined = rating != null ? String(rating) : undefined
  let resolvedOpeningHours: string[] | undefined
  let resolvedPriceLevel: number | undefined
  if (body.placeId) {
    const details = await getPlaceDetails(body.placeId).catch(() => null)
    if (details) {
      if (resolvedRating == null && details.rating != null) {
        resolvedRating = String(details.rating)
      }
      if (details.openingHours) resolvedOpeningHours = details.openingHours
      if (details.priceLevel != null) resolvedPriceLevel = details.priceLevel
    }
  }

  const [activity] = await db
    .insert(activities)
    .values({
      ...rest,
      itineraryDayId,
      sortOrder,
      rating: resolvedRating,
      openingHours: resolvedOpeningHours,
      priceLevel: resolvedPriceLevel,
      costEstimate,
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

  const segments = await db.query.travelSegments.findMany({
    where: eq(travelSegments.itineraryDayId, itineraryDayId),
  })

  return { activity, segments }
})
