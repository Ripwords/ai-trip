/**
 * The single answer to "what does this trip cost".
 *
 * Three components used to compute this independently and disagree (#38):
 * `ExpenseTracker` summed expenses, `TripOverview` summed expenses again plus
 * its own category breakdown, and `TripStats` summed activity *estimates* —
 * so the number a user saw depended on which tab they were on, and none of
 * them counted reservations, which hold real money too.
 *
 * This is a pure function over already-fetched rows rather than one big SQL
 * aggregate: the settlement and planned-vs-actual maths are not expressible as
 * a single GROUP BY, the row count is capped at 200 expenses per trip, and a
 * pure function is testable to the cent. The endpoint that wraps it
 * (`GET /api/trips/:id/expenses/summary`) is the one round trip the client
 * makes; the client does no arithmetic at all.
 *
 * Everything is summed in integer minor units (shared/utils/money.ts) and
 * converted to numbers only on the way out.
 */

import { computeSettlement, type Settlement, type SettlementMember } from "./settlement"
import { fromMinorUnits, toMinorUnits } from "./money"

export interface SummaryExpense {
  id: string
  /** What was paid, in `currencyCode`. */
  amount: string
  currencyCode: string
  /** The trip-currency projection; null on rows written before #47. */
  amountInTripCurrency: string | null
  category: string
  paidAt: string | null
  paidById: string | null
  activityId: string | null
  splits: Record<string, string> | null
}

export interface SummaryActivity {
  id: string
  name: string
  dayNumber: number
  date: string
  costEstimate: string | null
}

export interface SummariseTripExpensesInput {
  tripCurrencyCode: string
  budget: string | null
  startDate: string
  endDate: string
  /** Injected so burn rate is testable. YYYY-MM-DD. */
  today: string
  expenses: readonly SummaryExpense[]
  activities: readonly SummaryActivity[]
  reservations: readonly { amount: string | null; status: string }[]
  members: readonly SettlementMember[]
}

export interface PlannedVsActual {
  activityId: string
  name: string
  dayNumber: number
  date: string
  planned: number
  actual: number
  /** actual - planned. Positive = over the estimate. */
  variance: number
}

export interface TripExpenseSummary {
  currencyCode: string
  /** Real money spent: expenses + reservations. */
  total: number
  expensesTotal: number
  reservationsTotal: number
  /** What the itinerary estimated — a plan, not a cost. */
  plannedTotal: number
  budget: number | null
  remaining: number | null
  budgetPercent: number | null
  expenseCount: number
  byCategory: { category: string; amount: number }[]
  byDay: { date: string; amount: number }[]
  byPayer: { userId: string; name: string; amount: number }[]
  byCurrency: { currencyCode: string; amount: number; amountInTripCurrency: number }[]
  /** Spend with no date, excluded from `byDay` so the two reconcile. */
  undatedTotal: number
  tripDays: number
  elapsedDays: number
  burnRatePerDay: number
  projectedTotal: number
  plannedVsActual: PlannedVsActual[]
  linkedToActivitiesTotal: number
  unlinkedTotal: number
  settlement: Settlement
}

export function summariseTripExpenses(input: SummariseTripExpensesInput): TripExpenseSummary {
  const currency = input.tripCurrencyCode
  const toTrip = (text: string | null | undefined): number =>
    text == null ? 0 : (toMinorUnits(text, currency) ?? 0)
  const out = (minor: number): number => Number(fromMinorUnits(minor, currency))

  let expensesMinor = 0
  let undatedMinor = 0
  let linkedMinor = 0
  const byCategory = new Map<string, number>()
  const byDay = new Map<string, number>()
  const byPayer = new Map<string, number>()
  const byCurrency = new Map<string, { own: number; trip: number }>()
  const actualByActivity = new Map<string, number>()

  const activityIds = new Set(input.activities.map((a) => a.id))

  for (const e of input.expenses) {
    // Rows predating per-expense currencies have no projection.
    const minor = toTrip(e.amountInTripCurrency ?? e.amount)
    expensesMinor += minor

    byCategory.set(e.category || "other", (byCategory.get(e.category || "other") ?? 0) + minor)

    if (e.paidAt) byDay.set(e.paidAt, (byDay.get(e.paidAt) ?? 0) + minor)
    else undatedMinor += minor

    if (e.paidById) byPayer.set(e.paidById, (byPayer.get(e.paidById) ?? 0) + minor)

    const own = byCurrency.get(e.currencyCode) ?? { own: 0, trip: 0 }
    own.own += toMinorUnits(e.amount, e.currencyCode) ?? 0
    own.trip += minor
    byCurrency.set(e.currencyCode, own)

    if (e.activityId && activityIds.has(e.activityId)) {
      linkedMinor += minor
      actualByActivity.set(e.activityId, (actualByActivity.get(e.activityId) ?? 0) + minor)
    }
  }

  // A cancelled booking is money that is not committed, so it must not move
  // the budget bar. This lived in a client-side rollup until #61's double-count
  // was found; the server total is the only total now, so the rule lives here.
  let reservationsMinor = 0
  for (const r of input.reservations) {
    if (r.status === "cancelled") continue
    reservationsMinor += toTrip(r.amount)
  }

  let plannedMinor = 0
  const plannedVsActual: PlannedVsActual[] = []
  for (const a of input.activities) {
    const planned = toTrip(a.costEstimate)
    plannedMinor += planned
    const actual = actualByActivity.get(a.id) ?? 0
    // An activity with no estimate and no spend has nothing to compare.
    if (planned === 0 && actual === 0) continue
    plannedVsActual.push({
      activityId: a.id,
      name: a.name,
      dayNumber: a.dayNumber,
      date: a.date,
      planned: out(planned),
      actual: out(actual),
      variance: out(actual - planned),
    })
  }

  const totalMinor = expensesMinor + reservationsMinor
  const budgetMinor = input.budget == null ? null : toTrip(input.budget)

  const nameById = new Map(input.members.map((m) => [m.userId, m.user.name]))

  const tripDays = countDaysInclusive(input.startDate, input.endDate)
  const elapsedDays = clamp(countDaysInclusive(input.startDate, input.today), 0, tripDays)
  const burnRateMinor = elapsedDays > 0 ? Math.round(expensesMinor / elapsedDays) : 0
  // Before the trip starts there is no rate to extrapolate from, so report the
  // real figure rather than a projection built on a divide-by-zero guard.
  const projectedMinor =
    elapsedDays > 0 ? Math.round((expensesMinor / elapsedDays) * tripDays) : expensesMinor

  return {
    currencyCode: currency,
    total: out(totalMinor),
    expensesTotal: out(expensesMinor),
    reservationsTotal: out(reservationsMinor),
    plannedTotal: out(plannedMinor),
    budget: budgetMinor == null ? null : out(budgetMinor),
    remaining: budgetMinor == null ? null : out(budgetMinor - totalMinor),
    budgetPercent:
      budgetMinor == null || budgetMinor === 0
        ? null
        : Math.round((totalMinor / budgetMinor) * 10000) / 100,
    expenseCount: input.expenses.length,
    byCategory: [...byCategory.entries()]
      .map(([category, minor]) => ({ category, amount: out(minor) }))
      .toSorted((a, b) => b.amount - a.amount || a.category.localeCompare(b.category)),
    byDay: [...byDay.entries()]
      .map(([date, minor]) => ({ date, amount: out(minor) }))
      .toSorted((a, b) => a.date.localeCompare(b.date)),
    byPayer: [...byPayer.entries()]
      .map(([userId, minor]) => ({
        userId,
        name: nameById.get(userId) ?? "",
        amount: out(minor),
      }))
      .toSorted((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId)),
    byCurrency: [...byCurrency.entries()]
      .map(([currencyCode, sums]) => ({
        currencyCode,
        amount: Number(fromMinorUnits(sums.own, currencyCode)),
        amountInTripCurrency: out(sums.trip),
      }))
      .toSorted((a, b) => b.amountInTripCurrency - a.amountInTripCurrency),
    undatedTotal: out(undatedMinor),
    tripDays,
    elapsedDays,
    burnRatePerDay: out(burnRateMinor),
    projectedTotal: out(projectedMinor),
    plannedVsActual,
    linkedToActivitiesTotal: out(linkedMinor),
    unlinkedTotal: out(expensesMinor - linkedMinor),
    settlement: safeSettlement(input, currency),
  }
}

/**
 * The settlement is one panel of many. `simplifyDebts` throws when balances do
 * not reconcile, and this function feeds every money figure on the trip page —
 * so an unreconcilable set must degrade that one panel, not blank the total,
 * the budget, the breakdowns and the burn rate along with it.
 */
function safeSettlement(input: SummariseTripExpensesInput, currency: string): Settlement {
  try {
    return computeSettlement(input.expenses, input.members, currency)
  } catch (error: unknown) {
    console.error("[expense-summary] settlement failed, reporting no transfers:", error)
    return { balances: [], transfers: [], attributedTotal: 0, unattributedTotal: 0 }
  }
}

/** Calendar days from `from` to `to` inclusive; 0 when `to` is before `from`. */
function countDaysInclusive(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / 86_400_000) + 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
