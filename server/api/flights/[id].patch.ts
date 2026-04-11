import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema, updateFlightSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updateFlightSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  const [updated] = await db
    .update(flights)
    .set({ tripId: body.tripId ?? null })
    .where(eq(flights.id, id))
    .returning()

  return updated
})
