import { eq } from "drizzle-orm"
import { db } from "../../db"
import { trips, itineraryDays } from "../../db/schema"
import { createTripSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createTripSchema.parse)

  const [trip] = await db
    .insert(trips)
    .values({
      userId: session.user.id,
      destination: body.destination,
      startDate: body.startDate,
      endDate: body.endDate,
      preferences: body.preferences ?? {},
      currencyCode: body.currencyCode ?? "USD",
    })
    .returning()

  // Auto-create itinerary days based on date range
  const start = new Date(body.startDate)
  const end = new Date(body.endDate)
  const numDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

  const dayValues = Array.from({ length: numDays }, (_, i) => {
    const dayDate = new Date(start)
    dayDate.setDate(dayDate.getDate() + i)
    return {
      tripId: trip!.id,
      dayNumber: i + 1,
      date: dayDate.toISOString().split("T")[0]!,
    }
  })

  await db.insert(itineraryDays).values(dayValues)

  // Return trip with days
  const result = await db.query.trips.findFirst({
    where: eq(trips.id, trip!.id),
    with: {
      days: {
        with: {
          activities: true,
          travelSegments: true,
        },
      },
    },
  })

  return result
})
