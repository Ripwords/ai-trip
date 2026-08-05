import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { activities, expenses, itineraryDays, reservations, trips } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { listSettlementMembers } from "../../../../lib/expenses"
import { summariseTripExpenses } from "../../../../../shared/utils/expense-summary"

/**
 * The one place "what does this trip cost" is answered (#38).
 *
 * ExpenseTracker, TripOverview and TripStats each used to compute their own
 * total client-side, from three different sets of columns, and disagree. They
 * now all render this response, and the browser never sees a full expense
 * table just to add it up.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    columns: { currencyCode: true, budget: true, startDate: true, endDate: true },
  })
  if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

  const [expenseRows, activityRows, reservationRows, members] = await Promise.all([
    db.query.expenses.findMany({
      where: eq(expenses.tripId, id),
      columns: {
        id: true,
        amount: true,
        category: true,
        paidAt: true,
        paidById: true,
        activityId: true,
        splits: true,
      },
    }),
    db
      .select({
        id: activities.id,
        name: activities.name,
        dayNumber: itineraryDays.dayNumber,
        date: itineraryDays.date,
        costEstimate: activities.costEstimate,
      })
      .from(activities)
      .innerJoin(itineraryDays, eq(activities.itineraryDayId, itineraryDays.id))
      .where(eq(itineraryDays.tripId, id)),
    // `status` comes along so `summariseTripExpenses` can drop cancelled rows —
    // filtering here instead would put the rule somewhere no unit test reaches.
    db
      .select({ amount: reservations.amount, status: reservations.status })
      .from(reservations)
      .where(eq(reservations.tripId, id)),
    listSettlementMembers(id),
  ])

  // Everything the trip page shows about money comes from this one call, so a
  // throw in the arithmetic blanks the total, the budget, every breakdown and
  // the burn rate at once. `summariseTripExpenses` already contains a failing
  // settlement; this is the outer belt for anything it does not anticipate.
  try {
    return summariseTripExpenses({
      tripCurrencyCode: trip.currencyCode,
      budget: trip.budget,
      startDate: trip.startDate,
      endDate: trip.endDate,
      today: new Date().toISOString().slice(0, 10),
      expenses: expenseRows,
      activities: activityRows,
      reservations: reservationRows,
      members,
    })
  } catch (error: unknown) {
    console.error("[expenses/summary] could not summarise trip", id, error)
    throw createError({
      statusCode: 500,
      message: "Could not summarise this trip's expenses",
    })
  }
})
