import { eq } from "drizzle-orm"
import { db } from "../../db"
import { visitedCountries } from "../../db/schema"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const result = await db.query.visitedCountries.findMany({
    where: eq(visitedCountries.userId, session.user.id),
    orderBy: (vc, { desc }) => [desc(vc.createdAt)],
  })

  return result
})
