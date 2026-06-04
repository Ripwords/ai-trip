import { eq, and, isNull } from "drizzle-orm"
import { db } from "../../db"
import { trips, visitedCountries } from "../../db/schema"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const countryCode = getRouterParam(event, "countryCode")?.toUpperCase()

  if (!countryCode || countryCode.length !== 2) {
    throw createError({ statusCode: 400, message: "Invalid country code" })
  }

  const deleted = await db
    .delete(visitedCountries)
    .where(
      and(
        eq(visitedCountries.userId, session.user.id),
        eq(visitedCountries.countryCode, countryCode),
      ),
    )
    .returning()

  const suppressed = await db
    .update(trips)
    .set({ exploreSuppressedAt: new Date() })
    .where(
      and(
        eq(trips.userId, session.user.id),
        eq(trips.countryCode, countryCode),
        isNull(trips.exploreSuppressedAt),
      ),
    )
    .returning({ id: trips.id })

  if (!deleted.length && !suppressed.length) {
    throw createError({ statusCode: 404, message: "Country not found in visited list" })
  }

  return { success: true, suppressed: suppressed.length > 0 }
})
