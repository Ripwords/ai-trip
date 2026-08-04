import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { itineraryDays } from "../../../../../db/schema"
import { dayIdParamsSchema, updateAccommodationSchema } from "../../../../../utils/schemas"
import { reconcileTripStays } from "../../../../../lib/booking-sync"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const body = await readValidatedBody(event, updateAccommodationSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify day belongs to trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  // One transaction: the day's accommodation columns are the write path, and
  // reconciling turns them into the canonical stay plus its derived booking.
  // Half of that landing would leave a stay pointing at nights it no longer has.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(itineraryDays)
      .set(body)
      .where(eq(itineraryDays.id, dayId))
      .returning()

    await reconcileTripStays(tx, id, session.user.id)
    return row
  })

  return updated
})
