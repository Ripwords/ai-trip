import { eq } from "drizzle-orm"
import { z } from "zod"
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

/**
 * "Today" for the burn rate and the elapsed-day count.
 *
 * This used to be `new Date().toISOString().slice(0, 10)` — UTC — so for every
 * user west of Greenwich the trip was a day behind their own calendar in the
 * evening, and a day ahead for users east of it in the morning. The server has
 * no way to know the caller's timezone, so the client sends its own calendar
 * date (the same `todayCalendarDate()` the expense form uses) and UTC remains
 * the fallback for callers that don't.
 *
 * Same shape as `calendarDate` in utils/schemas.ts; kept local because that one
 * is not exported.
 */
const summaryQuerySchema = z.object({
  // `?today=` (a control the client left empty) means "not supplied", the same
  // convention the expense list's filters use — not a validation failure.
  today: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date")
      .optional(),
  ),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const query = await getValidatedQuery(event, summaryQuerySchema.parse)

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
        currencyCode: true,
        amountInTripCurrency: true,
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
      today: query.today ?? new Date().toISOString().slice(0, 10),
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
