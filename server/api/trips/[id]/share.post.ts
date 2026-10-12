import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import crypto from "crypto"

const SHARE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000

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

  // Toggle: a live link is unshared; no link, or an expired one, gets a fresh
  // token. An expired link already returns 410 to visitors (`/api/shared/:token`),
  // so treating it as "shared" made the toggle unshare when the owner wanted
  // a working link back.
  const now = Date.now()
  const isLive = !!trip.shareToken && (!trip.shareExpiresAt || trip.shareExpiresAt.getTime() > now)
  const newToken = isLive ? null : crypto.randomUUID()
  const shareExpiresAt = newToken ? new Date(now + SHARE_LINK_TTL_MS) : null

  await db.update(trips).set({ shareToken: newToken, shareExpiresAt }).where(eq(trips.id, id))

  return {
    shareToken: newToken,
    shared: !!newToken,
    expiresAt: shareExpiresAt?.toISOString() ?? null,
  }
})
