import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { reservations } from "../../../../db/schema"
import {
  reservationIdParamsSchema,
  updateReservationSchema,
  updateLinkedReservationSchema,
} from "../../../../utils/schemas"

/** Fields a derived booking mirrors from its stay, so it doesn't own them. */
const MIRRORED_FIELDS = ["type", "name", "startDate", "endDate"] as const

type ReservationUpdate = Partial<typeof reservations.$inferInsert>

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, reservationId } = await getValidatedRouterParams(
    event,
    reservationIdParamsSchema.parse,
  )
  // Read raw: which schema applies depends on whether the row is derived, and
  // that isn't known until the row has been loaded.
  const raw = await readBody<Record<string, unknown> | null>(event)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const reservation = await db.query.reservations.findFirst({
    where: and(eq(reservations.id, reservationId), eq(reservations.tripId, id)),
  })

  if (!reservation) {
    throw createError({ statusCode: 404, message: "Reservation not found" })
  }

  let values: ReservationUpdate

  if (reservation.source === "manual") {
    const { startDate, endDate, ...rest } = updateReservationSchema.parse(raw)
    values = {
      ...rest,
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
    }
  } else {
    // A derived row's name and dates belong to the stay that owns them.
    // Rejecting rather than ignoring keeps a stale client from believing it
    // renamed a hotel it didn't.
    const attempted = MIRRORED_FIELDS.filter((field) => raw != null && field in raw)
    if (attempted.length > 0) {
      throw createError({
        statusCode: 409,
        message: `This booking is linked to your itinerary. Change ${attempted.join(", ")} in the itinerary, not here.`,
      })
    }
    values = updateLinkedReservationSchema.parse(raw)
  }

  const [updated] = await db
    .update(reservations)
    .set(values)
    .where(eq(reservations.id, reservationId))
    .returning()

  return updated
})
