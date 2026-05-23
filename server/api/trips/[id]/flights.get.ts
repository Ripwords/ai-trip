import { uuidParamsSchema } from "../../../utils/schemas"
import { getTripFlightsForUser } from "../../../lib/trip-flights"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  return getTripFlightsForUser({ tripId: id, userId: session.user.id })
})
