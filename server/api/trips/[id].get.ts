import { uuidParamsSchema } from "../../utils/schemas"
import { getTripWithRelations } from "../../lib/trips"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const access = await requireTripAccess(id, session.user.id)

  const trip = await getTripWithRelations(id)
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // shareToken is owner-only — anyone else holding it can mint /shared/<token>.
  return {
    ...trip,
    _role: access.role,
    shareToken: access.role === "owner" ? trip.shareToken : null,
  }
})
