import { eq, sql } from "drizzle-orm"
import { countryByAlpha2 } from "~/data/countries"
import { db } from "../../db"
import { trips, itineraryDays } from "../../db/schema"
import { createTripSchema } from "../../utils/schemas"
import { enumerateDates } from "../../lib/dates"
import { getTripWithRelations } from "../../lib/trips"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createTripSchema.parse)

  const country = countryByAlpha2.get(body.countryCode)
  if (!country) {
    throw createError({ statusCode: 400, message: "Unknown country" })
  }

  if (body.endDate < body.startDate) {
    throw createError({ statusCode: 400, message: "End date must be on or after start date" })
  }

  // Check per-user trip limit
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(trips)
    .where(eq(trips.userId, session.user.id))
  if (count >= 50) {
    throw createError({ statusCode: 400, message: "Maximum number of trips reached (50)" })
  }

  const name = body.name?.trim() || null
  const [trip] = await db
    .insert(trips)
    .values({
      userId: session.user.id,
      destination: name ?? country.name,
      name,
      countryCode: country.alpha2,
      startDate: body.startDate,
      endDate: body.endDate,
      preferences: body.preferences ?? {},
      currencyCode: body.currencyCode ?? country.currency,
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
