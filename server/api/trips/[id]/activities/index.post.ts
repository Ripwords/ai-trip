import { uuidParamsSchema, addActivitySchema } from "../../../../utils/schemas"
import { addActivity } from "../../../../lib/trip-writes"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, addActivitySchema.parse)

  return await addActivity(session.user.id, id, body)
})
