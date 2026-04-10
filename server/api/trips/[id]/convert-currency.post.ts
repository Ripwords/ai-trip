import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { trips, activities, expenses } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"

const bodySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  if (body.from === body.to) {
    return { converted: false, rate: 1 }
  }

  // Fetch exchange rate
  const rateResponse = await $fetch<{ rate: number }>(
    `https://api.frankfurter.dev/v2/rate/${body.from}/${body.to}`,
  )
  const rate = rateResponse.rate

  // Get all activities for this trip
  const tripDays = await db.query.itineraryDays.findMany({
    where: (d, { eq: e }) => e(d.tripId, id),
    with: { activities: true },
  })

  // Convert activity costs
  for (const day of tripDays) {
    for (const activity of day.activities) {
      const updates: Record<string, string | null> = {}

      if (activity.costEstimate) {
        const converted = parseFloat(activity.costEstimate) * rate
        updates.costEstimate = converted.toFixed(2)
      }
      if (activity.actualCost) {
        const converted = parseFloat(activity.actualCost) * rate
        updates.actualCost = converted.toFixed(2)
      }

      if (Object.keys(updates).length > 0) {
        await db.update(activities).set(updates).where(eq(activities.id, activity.id))
      }
    }
  }

  // Convert expenses
  const tripExpenses = await db.query.expenses.findMany({
    where: (e, { eq: eqFn }) => eqFn(e.tripId, id),
  })

  for (const expense of tripExpenses) {
    const converted = parseFloat(expense.amount) * rate
    await db
      .update(expenses)
      .set({ amount: converted.toFixed(2) })
      .where(eq(expenses.id, expense.id))
  }

  // Convert budget
  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (trip?.budget) {
    const convertedBudget = parseFloat(trip.budget) * rate
    await db
      .update(trips)
      .set({
        budget: convertedBudget.toFixed(2),
        currencyCode: body.to,
      })
      .where(eq(trips.id, id))
  } else {
    await db.update(trips).set({ currencyCode: body.to }).where(eq(trips.id, id))
  }

  return { converted: true, rate }
})
