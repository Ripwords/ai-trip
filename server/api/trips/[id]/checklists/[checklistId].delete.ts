import { and, eq } from "drizzle-orm"
import { db } from "../../../../db"
import { checklists } from "../../../../db/schema"
import { checklistIdParamsSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, checklistId } = await getValidatedRouterParams(event, checklistIdParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify checklist belongs to trip
  const checklist = await db.query.checklists.findFirst({
    where: and(eq(checklists.id, checklistId), eq(checklists.tripId, id)),
  })

  if (!checklist) {
    throw createError({ statusCode: 404, message: "Checklist not found" })
  }

  await db.delete(checklists).where(eq(checklists.id, checklistId))

  return { success: true }
})
