import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { trips, activities } from "../../../../../db/schema"
import { activityIdParamsSchema } from "../../../../../utils/schemas"
import { enrichSingleActivity } from "../../../../../lib/enrich"

const ENRICH_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/**
 * Re-enrich a single activity with Google Places data.
 * Skips if the activity was already attempted within the last hour.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, activityId } = await getValidatedRouterParams(event, activityIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { destination: true },
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: { day: true },
  })

  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" })
  }

  // Skip if attempted recently
  if (
    activity.lastEnrichAttempt &&
    Date.now() - activity.lastEnrichAttempt.getTime() < ENRICH_COOLDOWN_MS
  ) {
    return { success: false, message: "Enrichment was already attempted recently" }
  }

  // Mark attempt upfront
  await db
    .update(activities)
    .set({ lastEnrichAttempt: new Date() })
    .where(eq(activities.id, activityId))

  const result = await enrichSingleActivity(activity.name, trip.destination)

  if (!result) {
    return { success: false, message: `Could not find "${activity.name}" on Google Maps` }
  }

  const [updated] = await db
    .update(activities)
    .set({
      placeId: result.placeId,
      lat: result.lat,
      lng: result.lng,
      rating: result.rating?.toString() ?? null,
      address: result.address,
    })
    .where(eq(activities.id, activityId))
    .returning()

  return { success: true, activity: updated }
})
