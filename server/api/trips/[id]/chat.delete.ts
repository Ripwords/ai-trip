import { uuidParamsSchema } from "../../../utils/schemas"
import { clearChatThread } from "../../../lib/trip-chat"

/**
 * Clear the caller's own transcript for this trip — what the dock's "Clear
 * conversation" button now does. Scoped to (trip_id, user_id) by
 * `clearChatThread`, so an owner cannot wipe a co-traveller's thread.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  const deleted = await clearChatThread(id, session.user.id)
  return { deleted }
})
