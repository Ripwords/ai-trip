import { eq, asc, inArray } from "drizzle-orm"
import { db } from "../../../../db"
import { itineraryDays, reservations } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { missingBookingFields } from "../../../../lib/booking-sync"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const access = await requireTripAccess(id, session.user.id)

  const rows = await db.query.reservations.findMany({
    where: eq(reservations.tripId, id),
    orderBy: [asc(reservations.startDate)],
  })

  // confirmationNumber is encryptedText (booking confirmations — sufficient on
  // many providers to modify/cancel). Only editors/owners need to see it.
  if (access.role === "viewer") {
    for (const r of rows) {
      r.confirmationNumber = null
    }
  }

  // The first night of each linked stay, so a derived row's "Edit in
  // itinerary" link lands on the day that actually owns the hotel.
  const stayIds = rows.flatMap((r) => (r.stayId ? [r.stayId] : []))
  const dayByStay = new Map<string, string>()
  if (stayIds.length > 0) {
    const days = await db
      .select({ id: itineraryDays.id, stayId: itineraryDays.stayId, date: itineraryDays.date })
      .from(itineraryDays)
      .where(inArray(itineraryDays.stayId, stayIds))
      .orderBy(asc(itineraryDays.date))
    for (const d of days) {
      if (d.stayId && !dayByStay.has(d.stayId)) dayByStay.set(d.stayId, d.id)
    }
  }

  // `missingFields` is computed server-side so the Bookings tab prompts for
  // exactly the gaps a derived row still has, and nothing the itinerary
  // already knows. Computed after redaction: a viewer can't fill anything in
  // anyway, and leaking "this one has a confirmation number" isn't worth it.
  return rows.map((r) =>
    Object.assign(r, {
      missingFields: missingBookingFields(r),
      itineraryDayId: r.stayId ? (dayByStay.get(r.stayId) ?? null) : null,
    }),
  )
})
