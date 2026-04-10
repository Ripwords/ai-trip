import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { packingTemplates } from "../../db/schema"
import { packingTemplateIdParamsSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { templateId } = await getValidatedRouterParams(event, packingTemplateIdParamsSchema.parse)

  // Only allow deleting own templates (not global)
  const template = await db.query.packingTemplates.findFirst({
    where: and(eq(packingTemplates.id, templateId), eq(packingTemplates.userId, session.user.id)),
  })

  if (!template) {
    throw createError({ statusCode: 404, message: "Template not found" })
  }

  await db.delete(packingTemplates).where(eq(packingTemplates.id, templateId))

  return { success: true }
})
