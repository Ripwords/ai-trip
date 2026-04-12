import { and, eq, or, desc } from "drizzle-orm"
import { db } from "../../../../../db"
import { checklists, checklistItems, packingTemplates } from "../../../../../db/schema"
import { checklistIdParamsSchema, loadTemplateSchema } from "../../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, checklistId } = await getValidatedRouterParams(event, checklistIdParamsSchema.parse)
  const body = await readValidatedBody(event, loadTemplateSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify checklist belongs to trip
  const checklist = await db.query.checklists.findFirst({
    where: and(eq(checklists.id, checklistId), eq(checklists.tripId, id)),
  })

  if (!checklist) {
    throw createError({ statusCode: 404, message: "Checklist not found" })
  }

  // Get template — only allow own templates or global ones
  const template = await db.query.packingTemplates.findFirst({
    where: and(
      eq(packingTemplates.id, body.templateId),
      or(eq(packingTemplates.userId, session.user.id), eq(packingTemplates.isGlobal, true)),
    ),
  })

  if (!template) {
    throw createError({ statusCode: 404, message: "Template not found" })
  }

  // Get current max sortOrder
  const lastItem = await db.query.checklistItems.findFirst({
    where: eq(checklistItems.checklistId, checklistId),
    orderBy: [desc(checklistItems.sortOrder)],
  })
  let nextOrder = (lastItem?.sortOrder ?? -1) + 1

  // Insert template items
  if (template.items.length > 0) {
    await db.insert(checklistItems).values(
      template.items.map((item) => ({
        checklistId,
        text: item.text,
        category: item.category,
        sortOrder: nextOrder++,
      })),
    )
  }

  return { success: true, itemsAdded: template.items.length }
})
