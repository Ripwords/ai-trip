import { eq } from "drizzle-orm"
import { db } from "../../db"
import { trips } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner"])

  // Cascade delete is handled by DB foreign key constraints
  await db.delete(trips).where(eq(trips.id, id))

  return { success: true }
})
