import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { itineraryDays, travelSegments } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  // Verify day belongs to trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  return db.query.travelSegments.findMany({
    where: eq(travelSegments.itineraryDayId, dayId),
  })
})
