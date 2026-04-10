import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { reservations } from "../../../../db/schema"
import { reservationIdParamsSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, reservationId } = await getValidatedRouterParams(
    event,
    reservationIdParamsSchema.parse,
  )

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.tripId, id)),
  })

  if (!reservation) {
    throw createError({ statusCode: 404, message: "Reservation not found" })
  }

  await db.delete(reservations).where(eq(reservations.id, reservationId))

  return { success: true }
})
