import { eq } from "drizzle-orm"
import { db } from "../../db"
import { trips } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"
import { purgeAttachmentObjects, storageKeysForTrip } from "../../lib/expense-attachments"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner"])

  // Receipt bytes live outside the row that references them, so the foreign
  // keys cannot reclaim them. Collect the keys before the cascade removes the
  // rows that name them (#48).
  const storageKeys = await storageKeysForTrip(id)

  // Cascade delete is handled by DB foreign key constraints
  await db.delete(trips).where(eq(trips.id, id))

  await purgeAttachmentObjects(storageKeys)

  return { success: true }
})
