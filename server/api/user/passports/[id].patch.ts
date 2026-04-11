import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"
import { uuidParamsSchema, updatePassportSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updatePassportSchema.parse)

  // Verify ownership
  const passport = await db.query.userPassports.findFirst({
    where: and(eq(userPassports.id, id), eq(userPassports.userId, session.user.id)),
  })

  if (!passport) {
    throw createError({ statusCode: 404, message: "Passport not found" })
  }

  // If setting as default, unset all others first
  if (body.isDefault) {
    await db
      .update(userPassports)
      .set({ isDefault: false })
      .where(eq(userPassports.userId, session.user.id))
  }

  const [updated] = await db
    .update(userPassports)
    .set({
      ...(body.label !== undefined ? { label: body.label ?? null } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    })
    .where(eq(userPassports.id, id))
    .returning()

  return updated
})
