import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import crypto from "crypto"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner"])

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Toggle: if already shared, unshare; if not, generate token
  const newToken = trip.shareToken ? null : crypto.randomUUID()
  const shareExpiresAt = newToken ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null

  await db.update(trips).set({ shareToken: newToken, shareExpiresAt }).where(eq(trips.id, id))

  return { shareToken: newToken, shared: !!newToken }
})
