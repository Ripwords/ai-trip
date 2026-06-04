import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { trips } from "../../db/schema"

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

  // Return only public-safe fields — no preferences, notes, costs, or accommodation.
  // Accommodation is intentionally omitted: revealing where the owner sleeps is a
  // physical-safety leak for anyone the share link is forwarded to.
  // Photos are temporarily disabled to eliminate Places Photo API spend.
  return {
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
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
        suggestedTime: a.suggestedTime,
        estimatedDurationMinutes: a.estimatedDurationMinutes,
        tags: a.tags,
        sortOrder: a.sortOrder,
        placeId: a.placeId,
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
