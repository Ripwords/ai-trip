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

/**
 * `readValidatedBody` turns a schema throw into a 400 for us; parsing by hand
 * here does not, so a bad amount escaped as an unhandled 500. Which schema
 * applies isn't known until the row is loaded, so the wrapper has to be ours.
 */
function parseBody<T>(parse: (input: unknown) => T, raw: unknown): T {
  try {
    return parse(raw)
  } catch (error) {
    throw createError({
      statusCode: 400,
      message: error instanceof Error ? error.message : "Bad Request",
    })
  }
}

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

  // `reservations.stay_id` is `ON DELETE SET NULL`, so a stay removed by any
  // path other than `reconcileTripStays` (a raw delete, a future cascade) would
  // leave `source = 'stay'` with no stay behind it. Treating that as derived
  // made the row permanently uneditable — every PUT 409'd on fields owned by a
  // stay that no longer exists. No stay, no owner: it edits like a manual row.
  const derived = reservation.source === "stay" && reservation.stayId !== null

  if (!derived) {
    const { startDate, endDate, ...rest } = parseBody(updateReservationSchema.parse, raw)
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
    values = parseBody(updateLinkedReservationSchema.parse, raw)
  }

  // `datesInOrder` on the partial update schema only fires when the body
  // carries BOTH dates, and the Bookings form PATCHes one field at a time — so
  // sending `endDate` alone could put a check-out before its stored check-in
  // and the sort by `start_date` stopped meaning anything. The stored row is
  // the other half of the comparison, so this check can only live here.
  const effectiveStart = "startDate" in values ? values.startDate : reservation.startDate
  const effectiveEnd = "endDate" in values ? values.endDate : reservation.endDate
  if (effectiveStart && effectiveEnd && effectiveEnd.getTime() < effectiveStart.getTime()) {
    throw createError({
      statusCode: 400,
      message: "End date must not precede the start date",
    })
  }

  const [updated] = await db
    .update(reservations)
    .set(values)
    .where(eq(reservations.id, reservationId))
    .returning()

  return updated
})
