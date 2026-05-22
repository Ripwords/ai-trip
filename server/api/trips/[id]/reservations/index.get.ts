import { eq, asc } from "drizzle-orm"
import { db } from "../../../../db"
import { reservations } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"

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
  return rows
})
