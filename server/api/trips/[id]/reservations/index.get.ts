import { eq, asc } from "drizzle-orm"
import { db } from "../../../../db"
import { reservations } from "../../../../db/schema"
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

  // `missingFields` is computed server-side so the Bookings tab prompts for
  // exactly the gaps a derived row still has, and nothing the itinerary
  // already knows. Computed after redaction: a viewer can't fill anything in
  // anyway, and leaking "this one has a confirmation number" isn't worth it.
  return rows.map((r) => Object.assign(r, { missingFields: missingBookingFields(r) }))
})
