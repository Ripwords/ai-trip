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

  // A derived row is not the user's to delete: the stay still exists, so the
  // next reconcile would mirror a fresh blank booking straight back — the row
  // resurrects while the confirmation number and amount that were on it do not.
  // Refused rather than silently detached, matching the PUT, which already
  // 409s when a stale client tries to edit a mirrored field.
  if (reservation.source === "stay" && reservation.stayId !== null) {
    throw createError({
      statusCode: 409,
      message:
        "This booking is linked to your itinerary. Clear the accommodation on those days to remove it.",
    })
  }

  await db.delete(reservations).where(eq(reservations.id, reservationId))

  return { success: true }
})
