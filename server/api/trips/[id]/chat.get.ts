import { uuidParamsSchema } from "../../../utils/schemas"
import { loadChatHistory } from "../../../lib/trip-chat"

/**
 * The caller's OWN discuss transcript for this trip.
 *
 * Two gates, both required:
 *  - `requireTripAccess` — losing access to the trip loses the transcript with
 *    it. No role restriction: a viewer can't start a discuss turn, but one who
 *    was demoted from editor still owns whatever they already said.
 *  - the thread filter inside `loadChatHistory`, which scopes on
 *    (trip_id, user_id). Trip access alone would hand a co-editor another
 *    member's prompts — the leak class of issue #57.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  return loadChatHistory(id, session.user.id)
})
