import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"
import { createPassportSchema } from "../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, createPassportSchema.parse)

  // If this is the first passport or isDefault is true, ensure only one default
  const existing = await db.query.userPassports.findMany({
    where: eq(userPassports.userId, session.user.id),
  })

  const shouldBeDefault = body.isDefault || existing.length === 0

  if (shouldBeDefault && existing.length > 0) {
    await db
      .update(userPassports)
      .set({ isDefault: false })
      .where(eq(userPassports.userId, session.user.id))
  }

  const [passport] = await db
    .insert(userPassports)
    .values({
      userId: session.user.id,
      countryCode: body.countryCode,
      label: body.label ?? null,
      isDefault: shouldBeDefault,
    })
    .returning()

  return passport
})
