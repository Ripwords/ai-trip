import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { itineraryDays } from "../../../../db/schema"
import { uuidParamsSchema, dateRangeQuerySchema } from "../../../../utils/schemas"
import { enumerateDates } from "../../../../lib/dates"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { startDate, endDate } = await getValidatedQuery(event, dateRangeQuerySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const days = await db.query.itineraryDays.findMany({
    where: eq(itineraryDays.tripId, id),
    with: {
      activities: {
        columns: { id: true, name: true },
      },
    },
  })

  const outside = days.filter((d) => d.date < startDate || d.date > endDate)

  const targetDates = enumerateDates(startDate, endDate)
  const existingDates = new Set(days.map((d) => d.date))
  const daysToAdd = targetDates.filter((d) => !existingDates.has(d)).length

  return {
    daysToDelete: outside.map((d) => ({
      id: d.id,
      dayNumber: d.dayNumber,
      date: d.date,
      activityCount: d.activities.length,
      activityNames: d.activities.map((a) => a.name),
    })),
    daysToAdd,
  }
})
