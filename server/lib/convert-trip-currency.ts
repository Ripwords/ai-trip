import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { db } from "../db"
import { trips, activities, expenses, reservations, itineraryDays } from "../db/schema"
import { currencyDecimals } from "../../shared/utils/currency"

/** Drizzle transaction handle, structurally (also satisfied by `db` itself). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Re-denominate a trip into `toCurrency`.
 *
 * Activity estimates, reservations and the budget have no currency of their
 * own — they are planning figures in the trip's currency — so they are
 * multiplied in place.
 *
 * Expenses are different: they record real payments, so `amount` and
 * `currencyCode` are left exactly as entered and only the derived
 * `amountInTripCurrency` / `fxRate` are re-projected. This function used to
 * multiply `expenses.amount` too, which destroyed the provenance of every
 * expense on the trip (#47).
 *
 * Runs inside the caller's transaction so a mid-flight failure can't leave the
 * trip half-converted.
 */
export async function convertTripMoney(
  tx: Tx,
  tripId: string,
  rate: number,
  toCurrency: string,
): Promise<void> {
  // Zero-decimal currencies (JPY, KRW, VND, …) have no minor unit, so a fixed
  // ROUND(..., 2) produced impossible values like "1234.56 JPY".
  const decimals = currencyDecimals(toCurrency)

  const dayRows = await tx
    .select({ id: itineraryDays.id })
    .from(itineraryDays)
    .where(eq(itineraryDays.tripId, tripId))
  const dayIds = dayRows.map((d) => d.id)

  if (dayIds.length > 0) {
    await tx
      .update(activities)
      .set({
        costEstimate: sql`ROUND(${activities.costEstimate}::numeric * ${rate}::numeric, ${decimals})`,
      })
      .where(and(inArray(activities.itineraryDayId, dayIds), isNotNull(activities.costEstimate)))

    await tx
      .update(activities)
      .set({
        actualCost: sql`ROUND(${activities.actualCost}::numeric * ${rate}::numeric, ${decimals})`,
      })
      .where(and(inArray(activities.itineraryDayId, dayIds), isNotNull(activities.actualCost)))
  }

  // Expenses are NOT rewritten. `amount` + `currencyCode` record what was
  // actually paid and are immutable; only the trip-currency *projection* moves.
  //
  // KNOWN BROKEN — this statement is why the PR is marked "needs rework":
  //
  // 1. It chains off its own previous output instead of re-deriving from the
  //    immutable `amount`, so error compounds. $100.00 cycled
  //    USD→JPY→EUR→USD three times lands on 100.06 with fxRate 1.00076386.
  //    An earlier version of this comment claimed composition "is exact". It
  //    is not, and the arithmetic above is the counter-example.
  // 2. `COALESCE(..., amount)` multiplies a FOREIGN-currency amount by a
  //    trip-to-trip rate. A ¥3,200 expense on a USD trip switching to EUR
  //    yields 2944 EUR instead of ~19 EUR — roughly 155x over. The same class
  //    of fallback sits in expense-summary.ts and settlement.ts.
  //
  // The fix is to re-derive from (`amount`, `currencyCode`) → new trip
  // currency with a real per-currency rate, which cannot be one statement.
  await tx
    .update(expenses)
    .set({
      amountInTripCurrency: sql`ROUND(COALESCE(${expenses.amountInTripCurrency}, ${expenses.amount})::numeric * ${rate}::numeric, ${decimals})`,
      fxRate: sql`ROUND(${expenses.fxRate}::numeric * ${rate}::numeric, 8)`,
    })
    .where(eq(expenses.tripId, tripId))

  await tx
    .update(reservations)
    .set({ amount: sql`ROUND(${reservations.amount}::numeric * ${rate}::numeric, ${decimals})` })
    .where(and(eq(reservations.tripId, tripId), isNotNull(reservations.amount)))

  await tx
    .update(trips)
    .set({
      budget: sql`CASE WHEN ${trips.budget} IS NULL THEN NULL ELSE ROUND(${trips.budget}::numeric * ${rate}::numeric, ${decimals}) END`,
      currencyCode: toCurrency,
    })
    .where(eq(trips.id, tripId))
}
