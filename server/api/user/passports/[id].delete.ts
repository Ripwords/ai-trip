import { and, eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const passport = await db.query.userPassports.findFirst({
    where: and(eq(userPassports.id, id), eq(userPassports.userId, session.user.id)),
  })

  if (!passport) {
    throw createError({ statusCode: 404, message: "Passport not found" })
  }

  await db.delete(userPassports).where(eq(userPassports.id, id))

  // If deleted passport was default, promote the next one
  if (passport.isDefault) {
    const next = await db.query.userPassports.findFirst({
      where: eq(userPassports.userId, session.user.id),
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    })
    if (next) {
      await db.update(userPassports).set({ isDefault: true }).where(eq(userPassports.id, next.id))
    }
  }

  return { success: true }
})
