import { eq } from "drizzle-orm"
import { db } from "../../db"
import { trips } from "../../db/schema"
import { uuidParamsSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  // Check access (owner, editor, or viewer)
  const access = await requireTripAccess(id, session.user.id)

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  return { ...trip, _role: access.role }
})
