/**
 * The trip's committed spend, across every store that holds money.
 *
 * `reservations.amount` used to be counted nowhere: the budget bar summed
 * expenses only, so a €900 hotel booking left it untouched. Auto-creating
 * bookings from the itinerary would have multiplied the number of
 * visible-but-uncounted amounts, so the rollup accounts for both.
 *
 * Bookings are prepaid commitments rather than on-trip spending, so the
 * breakdown stays visible — but both count against the budget, because from
 * the traveller's side both are money gone.
 *
 * A user who records the same hotel as both a booking and an expense will see
 * it twice; that's an entry-level duplicate this rollup can't detect, and the
 * split display is what makes it visible.
 */

export interface BudgetRollup {
  /** Logged on-trip spending. */
  expenses: number
  /** Prepaid booking amounts, cancelled rows excluded. */
  bookings: number
  total: number
}

/** `amount` is a numeric column read back as a string — one bad row used to NaN the lot. */
function toAmount(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function computeBudgetRollup(args: {
  expenses: readonly { amount: string | null }[]
  reservations: readonly { amount: string | null; status: string }[]
}): BudgetRollup {
  const expenses = args.expenses.reduce((sum, e) => sum + toAmount(e.amount), 0)
  const bookings = args.reservations.reduce(
    (sum, r) => (r.status === "cancelled" ? sum : sum + toAmount(r.amount)),
    0,
  )

  return { expenses, bookings, total: expenses + bookings }
}
