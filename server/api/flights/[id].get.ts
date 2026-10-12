import { and, eq } from "drizzle-orm"
import { db } from "../../db"
import { flights } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"
import { refreshDueFlights } from "../../lib/flight-refresh"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const flight = await db.query.flights.findFirst({
    where: and(eq(flights.id, id), eq(flights.userId, session.user.id)),
    with: { trip: { columns: { id: true, destination: true } } },
  })

  if (!flight) {
    throw createError({ statusCode: 404, message: "Flight not found" })
  }

  const [current] = await refreshDueFlights([flight])
  return current ?? flight
})
