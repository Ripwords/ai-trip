import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema, updateFlightSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updateFlightSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  // Owning the flight is not enough to file it under a trip: attaching makes
  // it part of that trip's plan, so the caller has to be able to see the trip
  // (audit B19). Detaching needs no trip check.
  if (body.tripId) {
    await requireTripAccess(body.tripId, session.user.id)
  }

  const [updated] = await db
    .update(flights)
    .set({ tripId: body.tripId ?? null })
    .where(eq(flights.id, id))
    .returning()

  return updated
})
