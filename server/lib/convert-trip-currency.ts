import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { db } from "../db"
import { trips, activities, expenses, reservations, itineraryDays } from "../db/schema"
import { currencyDecimals } from "../../shared/utils/currency"
import { fromMinorUnits, multiplyMinorUnits, toMinorUnits } from "../../shared/utils/money"

/** Drizzle transaction handle, structurally (also satisfied by `db` itself). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Looks up a rate, returning null when the pair cannot be priced. */
export type FetchRate = (from: string, to: string) => Promise<number | null>

export interface ConvertTripMoneyOptions {
  /** The trip's currency *before* this conversion. */
  fromCurrency: string
  toCurrency: string
  /** `fromCurrency` -> `toCurrency`. Applies to the planning figures. */
  rate: number
  /**
   * One rate per distinct *expense* currency on the trip, each into
   * `toCurrency`. Resolved by the caller before the transaction opens — see
   * `resolveExpenseProjectionRates`.
   */
  expenseRates: ReadonlyMap<string, number>
}

/** The row shape the projection needs. Narrow on purpose, so it stays testable. */
export interface ProjectableExpense {
  id: string
  /** What was paid, in `currencyCode`. Never modified. */
  amount: string
  /** NULL means "provenance unknown" — a row predating #47. See migration 0041. */
  currencyCode: string | null
  /** The current trip-currency projection, i.e. denominated in `fromCurrency`. */
  amountInTripCurrency: string
}

/**
 * Derive one expense's trip-currency projection.
 *
 * **Anchored on the immutable `amount`.** The previous implementation did this
 * in a single SQL statement:
 *
 * ```sql
 * amount_in_trip_currency = ROUND(COALESCE(amount_in_trip_currency, amount) * rate, d)
 * fx_rate                 = ROUND(fx_rate * rate, 8)
 * ```
 *
 * which is wrong twice over:
 *
 * 1. It composed each conversion against the *previous projection*, so `amount`
 *    was never an input and the error was monotonic — it could never re-anchor.
 *    $100.00 cycled USD->JPY->EUR->USD three times landed on 100.06 with
 *    fxRate 1.00076386, and `amount * fxRate` (100.0764) no longer matched the
 *    stored projection (100.06). Two derived fields that disagree destroy the
 *    explainable report #47 exists to provide. An earlier comment here claimed
 *    composition "is exact"; it is not, and that arithmetic is the disproof.
 * 2. `COALESCE(..., amount)` multiplied a *foreign* amount by a trip-to-trip
 *    rate — a category error. A ¥3,200 expense on a USD trip switching to EUR
 *    yielded 2944 EUR instead of ~18.99, about 155x over.
 *
 * Rate composition was simply the wrong primitive. A fresh rate for
 * (expense currency -> trip currency), applied once to `amount`, is exact by
 * construction, and a round trip returns the original figure to the cent.
 *
 * This is deliberately not SQL: a trip holding both JPY and USD expenses needs
 * two different rates in the same conversion, so one `UPDATE ... SET x = x *
 * rate` cannot express it — which is exactly what the old design was built to
 * avoid, and exactly why it was wrong.
 */
export function projectExpenseToTripCurrency(
  row: ProjectableExpense,
  fromCurrency: string,
  toCurrency: string,
  expenseRates: ReadonlyMap<string, number>,
  /** `fromCurrency` -> `toCurrency`, used only for unknown-provenance rows. */
  legacyRate: number,
): { amountInTripCurrency: string; fxRate: string | null } {
  // Unknown provenance: there is no source currency, so there is no rate to
  // state and nothing to re-anchor against. The best available reading is the
  // one this app has always used — the figure is in whatever the trip currency
  // was — so it moves with the trip, and `fx_rate` stays NULL rather than
  // asserting a conversion between a known currency and an unknown one.
  //
  // These rows do accumulate rounding across repeated conversions. That is
  // inherent rather than a bug being tolerated: a denomination nobody recorded
  // cannot be re-derived. The population is closed by migration 0041 and
  // shrinks to nothing as trips age out.
  if (row.currencyCode == null) {
    const prior = toMinorUnits(row.amountInTripCurrency, fromCurrency) ?? 0
    return {
      amountInTripCurrency: fromMinorUnits(
        multiplyMinorUnits(prior, fromCurrency, legacyRate, toCurrency),
        toCurrency,
      ),
      fxRate: null,
    }
  }

  const code = row.currencyCode.toUpperCase()
  const fx = expenseRates.get(code)
  if (fx == null) {
    throw createError({
      statusCode: 502,
      message: `Could not fetch an exchange rate for ${code} → ${toCurrency}.`,
    })
  }

  const amountMinor = toMinorUnits(row.amount, code)
  if (amountMinor == null) {
    throw createError({
      statusCode: 500,
      message: `Expense ${row.id} holds a malformed amount "${row.amount}".`,
    })
  }

  return {
    amountInTripCurrency: fromMinorUnits(
      multiplyMinorUnits(amountMinor, code, fx, toCurrency),
      toCurrency,
    ),
    fxRate: fx.toFixed(8),
  }
}

/**
 * One rate per distinct expense currency, into `toCurrency`.
 *
 * Call this *before* opening the transaction: the FX provider is a network hop
 * and a slow upstream must not hold a database transaction open. Failing here
 * aborts the whole conversion, which is the point — half-converting a trip and
 * leaving the unpriceable rows stale would silently misstate its total.
 */
export async function resolveExpenseProjectionRates(
  currencyCodes: readonly (string | null)[],
  toCurrency: string,
  fetchRate: FetchRate,
): Promise<Map<string, number>> {
  const target = toCurrency.toUpperCase()
  // NULL is "provenance unknown" — no source currency, so nothing to price.
  const distinct = [
    ...new Set(currencyCodes.filter((c): c is string => c != null).map((c) => c.toUpperCase())),
  ]

  const out = new Map<string, number>()
  for (const code of distinct) {
    if (code === target) {
      // Never ask a provider what a currency is worth in itself. It is 1, and a
      // provider that answers 0.966 (as one did) turns a ¥3,200 lunch into
      // ¥3,093 on a trip that was already denominated in yen.
      out.set(code, 1)
      continue
    }
    const rate = await fetchRate(code, target)
    if (rate == null) {
      throw createError({
        statusCode: 502,
        message: `Could not fetch an exchange rate for ${code} → ${target}. No money was changed.`,
      })
    }
    out.set(code, rate)
  }
  return out
}

/**
 * Re-denominate a trip into `toCurrency`.
 *
 * Activity estimates, reservations and the budget have no currency of their
 * own — they are planning figures in the trip's currency — so they are
 * multiplied in place by the single trip-level `rate`.
 *
 * Expenses are different: they record real payments, so `amount` and
 * `currencyCode` are left exactly as entered and only the derived
 * `amountInTripCurrency` / `fxRate` are re-projected, each from its own
 * currency's rate. This function used to multiply `expenses.amount` too, which
 * destroyed the provenance of every expense on the trip (#47).
 *
 * Runs inside the caller's transaction so a mid-flight failure can't leave the
 * trip half-converted.
 */
export async function convertTripMoney(
  tx: Tx,
  tripId: string,
  options: ConvertTripMoneyOptions,
): Promise<void> {
  const { fromCurrency, toCurrency, rate, expenseRates } = options
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

  // Expenses are re-projected row by row rather than by one UPDATE, because a
  // mixed-currency trip needs a different rate per row, and because the maths
  // then goes through the same integer helpers as the write path — one
  // implementation, so re-projecting an unchanged trip is a no-op instead of
  // drifting a cent against what `POST /expenses` would have stored.
  //
  // The row count is capped per trip (server/lib/expense-cap.ts) and a currency
  // change is rare, so the extra statements are not a concern.
  const expenseRows = await tx
    .select({
      id: expenses.id,
      amount: expenses.amount,
      currencyCode: expenses.currencyCode,
      amountInTripCurrency: expenses.amountInTripCurrency,
    })
    .from(expenses)
    .where(eq(expenses.tripId, tripId))

  for (const row of expenseRows) {
    // Throws when a currency is missing from the map — the provider could not
    // price it, or a row was inserted between rate resolution and this
    // transaction. Either way the transaction rolls back and the trip keeps its
    // old currency, rather than ending up with some rows projected and some
    // stale, which no total would reconcile against.
    const projected = projectExpenseToTripCurrency(
      row,
      fromCurrency,
      toCurrency,
      expenseRates,
      rate,
    )
    await tx
      .update(expenses)
      .set({
        amountInTripCurrency: projected.amountInTripCurrency,
        fxRate: projected.fxRate,
      })
      .where(eq(expenses.id, row.id))
  }

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
