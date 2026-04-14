import { and, eq, isNull, isNotNull, or, lt, sql } from "drizzle-orm"
import { db } from "../../../../../db"
import { trips, itineraryDays, activities } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import { enrichSingleActivity } from "../../../../../lib/enrich"
import { computeAndSaveSegments } from "../../../../../lib/segments"

const ENRICH_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/**
 * Batch re-enrich all activities in a day that have null lat/lng.
 * Called automatically by the frontend when it detects unenriched activities.
 * Skips activities that were already attempted within the last hour.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { destination: true },
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Verify day belongs to trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  // Find activities missing coordinates that haven't been attempted recently
  const cooldownCutoff = new Date(Date.now() - ENRICH_COOLDOWN_MS)

  const unenriched = await db.query.activities.findMany({
    where: and(
      eq(activities.itineraryDayId, dayId),
      or(isNull(activities.lat), isNull(activities.lng)),
      or(isNull(activities.lastEnrichAttempt), lt(activities.lastEnrichAttempt, cooldownCutoff)),
    ),
  })

  if (unenriched.length === 0) {
    return { enriched: 0, failed: 0 }
  }

  // Mark all as attempted upfront to prevent concurrent duplicate requests
  await db
    .update(activities)
    .set({ lastEnrichAttempt: new Date() })
    .where(
      sql`${activities.id} IN (${sql.join(
        unenriched.map((a) => sql`${a.id}`),
        sql`, `,
      )})`,
    )

  // Use first geo-located activity as location bias
  const geoActivity = await db.query.activities.findFirst({
    where: and(
      eq(activities.itineraryDayId, dayId),
      isNotNull(activities.lat),
      isNotNull(activities.lng),
    ),
    columns: { lat: true, lng: true },
  })
  const destinationCoords =
    geoActivity?.lat != null && geoActivity?.lng != null
      ? { lat: geoActivity.lat, lng: geoActivity.lng }
      : undefined

  // Re-enrich in batches of 5
  let enrichedCount = 0
  let failedCount = 0
  const batchSize = 5

  for (let i = 0; i < unenriched.length; i += batchSize) {
    const batch = unenriched.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (activity) => {
        const result = await enrichSingleActivity(
          activity.name,
          trip.destination,
          destinationCoords,
        )
        return { activity, result }
      }),
    )

    for (const { activity, result } of results) {
      if (result) {
        await db
          .update(activities)
          .set({
            placeId: result.placeId,
            lat: result.lat,
            lng: result.lng,
            rating: result.rating?.toString() ?? null,
            address: result.address,
          })
          .where(eq(activities.id, activity.id))
        enrichedCount++
      } else {
        failedCount++
      }
    }
  }

  // Recompute travel segments if any activities were enriched
  if (enrichedCount > 0) {
    await computeAndSaveSegments(dayId)
  }

  return { enriched: enrichedCount, failed: failedCount }
})
