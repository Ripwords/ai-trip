import { createTripSchema } from "../../utils/schemas"
import { createTripOnce } from "../../lib/trip-writes"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createTripSchema.parse)

  return await createTripOnce(session.user.id, body)
})
