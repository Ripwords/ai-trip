import { and, eq, inArray } from "drizzle-orm"
import { db } from "~~/server/db"
import { itineraryDays } from "~~/server/db/schema"
import { lockTripForStayWrite, reconcileTripStays } from "~~/server/lib/booking-sync"

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

  // Same transaction as the per-day route: set the day columns, then derive
  // the stay and its booking from them.
  const updated = await db.transaction(async (tx) => {
    // Before the day write, never after — see `lockTripForStayWrite`.
    await lockTripForStayWrite(tx, id)

    const rows = await tx
      .update(itineraryDays)
      .set(accommodation)
      .where(and(eq(itineraryDays.tripId, id), inArray(itineraryDays.id, dayIds)))
      .returning()

    await reconcileTripStays(tx, id, session.user.id)
    return rows
  })

  return updated
})
