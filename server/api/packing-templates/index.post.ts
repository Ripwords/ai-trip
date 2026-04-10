import { db } from "../../db"
import { packingTemplates } from "../../db/schema"
import { createPackingTemplateSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createPackingTemplateSchema.parse)

  const [template] = await db
    .insert(packingTemplates)
    .values({
      name: body.name,
      description: body.description ?? undefined,
      items: body.items ?? [],
      userId: session.user.id,
      isGlobal: false,
    })
    .returning()

  return template
})
