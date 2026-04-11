import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  await db.delete(flights).where(eq(flights.id, id))
  return { success: true }
})
