import { eq, sql } from "drizzle-orm"
import { db } from "../../db"
import { trips, itineraryDays } from "../../db/schema"
import { createTripSchema } from "../../utils/schemas"
import { enumerateDates } from "../../lib/dates"
import { getTripWithRelations } from "../../lib/trips"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createTripSchema.parse)

  // Check per-user trip limit
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(trips)
    .where(eq(trips.userId, session.user.id))
  if (count >= 50) {
    throw createError({ statusCode: 400, message: "Maximum number of trips reached (50)" })
  }

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
  const dayValues = enumerateDates(body.startDate, body.endDate).map((date, i) => ({
    tripId: trip!.id,
    dayNumber: i + 1,
    date,
  }))

  await db.insert(itineraryDays).values(dayValues)

  return await getTripWithRelations(trip!.id)
})
