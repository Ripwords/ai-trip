import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { userPassports } from "../../../db/schema"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  return db.query.userPassports.findMany({
    where: eq(userPassports.userId, session.user.id),
    columns: {
      countryCode: true,
      expiryDate: true,
      isDefault: true,
    },
    orderBy: (p, { desc }) => [desc(p.isDefault), desc(p.createdAt)],
  })
})
