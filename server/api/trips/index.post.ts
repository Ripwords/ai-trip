import { createTripSchema } from "../../utils/schemas"
import { createTrip } from "../../lib/trip-writes"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createTripSchema.parse)

  return await createTrip(session.user.id, body)
})
