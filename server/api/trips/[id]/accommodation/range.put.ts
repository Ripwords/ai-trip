import { and, eq, inArray } from "drizzle-orm"
import { db } from "~~/server/db"
import { itineraryDays } from "~~/server/db/schema"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { dayIds, ...accommodation } = await readValidatedBody(
    event,
    updateAccommodationRangeSchema.parse,
  )

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const days = await db.query.itineraryDays.findMany({
    where: and(eq(itineraryDays.tripId, id), inArray(itineraryDays.id, dayIds)),
  })

  if (days.length !== dayIds.length) {
    throw createError({ statusCode: 404, message: "One or more days not found" })
  }

  const updated = await db
    .update(itineraryDays)
    .set(accommodation)
    .where(and(eq(itineraryDays.tripId, id), inArray(itineraryDays.id, dayIds)))
    .returning()

  return updated
})
