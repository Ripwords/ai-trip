import { eq, and } from "drizzle-orm"
import { db } from "../../db"
import { visitedCountries } from "../../db/schema"

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

  if (!deleted.length) {
    throw createError({ statusCode: 404, message: "Country not found in visited list" })
  }

  return { success: true }
})
