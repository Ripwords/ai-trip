import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { trips } from "../../db/schema"
import { getPlaceDetails } from "../../lib/google-maps"

const paramsSchema = z.object({
  token: z.string().uuid(),
})

export default defineEventHandler(async (event) => {
  const { token } = await getValidatedRouterParams(event, paramsSchema.parse)

  const trip = await db.query.trips.findFirst({
    where: eq(trips.shareToken, token),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Shared trip not found" })
  }

  if (trip.shareExpiresAt && trip.shareExpiresAt < new Date()) {
    throw createError({ statusCode: 410, message: "This shared link has expired" })
  }

  // Enrich photos for activities that have a placeId but no persisted photos.
  // getPlaceDetails is cached 7 days, so popular places hit memory after first call.
  const placeIdsNeedingPhotos = new Set<string>()
  for (const day of trip.days) {
    for (const a of day.activities) {
      if (a.placeId && !a.photos?.length) placeIdsNeedingPhotos.add(a.placeId)
    }
  }
  const enrichedPhotos = new Map<string, string[]>()
  await Promise.allSettled(
    [...placeIdsNeedingPhotos].map(async (placeId) => {
      const details = await getPlaceDetails(placeId)
      if (details?.photos?.length) enrichedPhotos.set(placeId, details.photos)
    }),
  )

  // Return only public-safe fields — no preferences, notes, costs, or accommodation.
  // Accommodation is intentionally omitted: revealing where the owner sleeps is a
  // physical-safety leak for anyone the share link is forwarded to.
  return {
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    currencyCode: trip.currencyCode,
    days: trip.days.map((day) => ({
      id: day.id,
      dayNumber: day.dayNumber,
      date: day.date,
      activities: day.activities.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        description: a.description,
        address: a.address,
        lat: a.lat,
        lng: a.lng,
        rating: a.rating,
        suggestedTime: a.suggestedTime,
        estimatedDurationMinutes: a.estimatedDurationMinutes,
        tags: a.tags,
        sortOrder: a.sortOrder,
        placeId: a.placeId,
        photos: a.photos?.length ? a.photos : (a.placeId && enrichedPhotos.get(a.placeId)) || [],
      })),
      travelSegments: day.travelSegments.map((s) => ({
        fromActivityId: s.fromActivityId,
        toActivityId: s.toActivityId,
        durationText: s.durationText,
        distanceText: s.distanceText,
        mode: s.mode,
      })),
    })),
  }
})
