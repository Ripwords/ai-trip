import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { trips, activities, expenses, reservations } from "../db/schema"

const { convertTripMoney, projectExpenseToTripCurrency, resolveExpenseProjectionRates } =
  await import("./convert-trip-currency")
type Tx = import("./convert-trip-currency").Tx

/**
 * These tests used to assert that the conversion SQL *mentioned* the right
 * columns and *contained* the right rounding literal. Every one of them passed
 * against a statement that chained each conversion off its own previous output
 * and multiplied foreign amounts by a trip-to-trip rate — a 155x error — because
 * not one of them ever evaluated a number.
 *
 * So: arithmetic. Shape is asserted in exactly one place, and only for the
 * columns that must NOT be written.
 */

const USD_EUR = 0.92
const USD_JPY = 155.0
const EUR_JPY = USD_JPY / USD_EUR

/** A rate table standing in for the FX provider, consistent in both directions. */
function rates(
  pairs: Record<string, number>,
): (from: string, to: string) => Promise<number | null> {
  return async (from, to) => {
    if (from === to) return 1
    const direct = pairs[`${from}/${to}`]
    if (direct != null) return direct
    const inverse = pairs[`${to}/${from}`]
    if (inverse != null) return 1 / inverse
    return null
  }
}

const table = rates({ "USD/EUR": USD_EUR, "USD/JPY": USD_JPY, "EUR/JPY": EUR_JPY })

function row(amount: string, currencyCode: string | null, amountInTripCurrency = amount) {
  return { id: "e1", amount, currencyCode, amountInTripCurrency }
}

describe("projectExpenseToTripCurrency — derives from the immutable amount", () => {
  it("projects a same-currency expense at exactly 1", () => {
    const p = projectExpenseToTripCurrency(
      row("100.00", "USD"),
      "USD",
      "USD",
      new Map([["USD", 1]]),
      1,
    )
    assert.equal(p.amountInTripCurrency, "100.00")
    assert.equal(p.fxRate, "1.00000000")
  })

  it("projects a foreign expense from `amount`, not from the previous projection", () => {
    // A ¥3,200 lunch on a USD trip. The old statement multiplied the *previous
    // projection* — and where that was NULL, the raw ¥3,200 — by a trip-to-trip
    // rate, yielding 2944 EUR for a ~19 EUR lunch.
    const p = projectExpenseToTripCurrency(
      row("3200", "JPY", "20.65"),
      "USD",
      "EUR",
      new Map([["JPY", USD_EUR / USD_JPY]]),
      USD_EUR,
    )
    assert.equal(p.amountInTripCurrency, "18.99")
    assert.notEqual(p.amountInTripCurrency, "2944.00")
  })

  it("reports ¥3,200 as ¥3,200 on a trip switched to JPY", () => {
    // The chained version handed a JPY expense a JPY->JPY rate of 0.966 and
    // reported ¥3,093 for a ¥3,200 lunch.
    const p = projectExpenseToTripCurrency(
      row("3200", "JPY", "20.65"),
      "USD",
      "JPY",
      new Map([["JPY", 1]]),
      USD_JPY,
    )
    assert.equal(p.amountInTripCurrency, "3200")
    assert.equal(p.fxRate, "1.00000000")
  })

  it("rounds a zero-decimal target currency to whole units", () => {
    const p = projectExpenseToTripCurrency(
      row("100.00", "USD"),
      "USD",
      "JPY",
      new Map([["USD", USD_JPY]]),
      USD_JPY,
    )
    assert.equal(p.amountInTripCurrency, "15500")
    assert.ok(!p.amountInTripCurrency.includes("."), "JPY has no minor unit")
  })

  it("carries an unknown-provenance row's figure without inventing a rate", () => {
    // currency_code IS NULL means "we do not know what this was paid in" — see
    // migration 0041. With no source currency there is no rate to state, but
    // the row still has to produce a number.
    const p = projectExpenseToTripCurrency(
      row("100.00", null, "100.00"),
      "USD",
      "EUR",
      new Map(),
      USD_EUR,
    )
    assert.equal(p.amountInTripCurrency, "92.00")
    assert.equal(p.fxRate, null, "a rate between an unknown currency and EUR is not a fact")
  })

  it("throws rather than guessing when a known currency has no rate", () => {
    assert.throws(
      () => projectExpenseToTripCurrency(row("50.00", "GBP"), "USD", "EUR", new Map(), USD_EUR),
      /GBP/,
    )
  })
})

/** Records every write so the tests can assert resulting values, not SQL shape. */
function makeFakeTx(
  dayRows: { id: string }[],
  expenseRows: {
    id: string
    amount: string
    currencyCode: string | null
    amountInTripCurrency: string
  }[],
) {
  const updates: { table: unknown; set: Record<string, unknown> }[] = []
  const fake = {
    select: () => ({
      from: (t: unknown) => ({ where: async () => (t === expenses ? expenseRows : dayRows) }),
    }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (predicate?: unknown) => {
          updates.push({ table: t, set: values })
          void predicate
          // Apply expense writes back, so a round trip can actually be simulated.
          if (t === expenses && typeof values.amountInTripCurrency === "string") {
            for (const r of expenseRows) r.amountInTripCurrency = values.amountInTripCurrency
          }
        },
      }),
    }),
  }
  // Structural fake for the drizzle transaction handle — accepted case for the cast.
  return { tx: fake as unknown as Tx, updates, expenseRows }
}

describe("convertTripMoney", () => {
  it("returns a USD expense to exactly its original figure after three USD->JPY->EUR->USD cycles", async () => {
    // The reviewer's counter-example. The chained implementation landed on
    // 100.06 with fxRate 1.00076386 while `amount` sat untouched at 100.00 — so
    // `amount * fxRate` no longer equalled the stored projection either, and the
    // "explainable report" property #47 exists to provide was gone.
    const rows = [
      { id: "e1", amount: "100.00", currencyCode: "USD", amountInTripCurrency: "100.00" },
    ]
    const { tx, expenseRows } = makeFakeTx([], rows)

    let from = "USD"
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const to of ["JPY", "EUR", "USD"]) {
        const rate = (await table(from, to)) ?? 1
        const expenseRates = await resolveExpenseProjectionRates(["USD"], to, table)
        await convertTripMoney(tx, "trip-1", {
          fromCurrency: from,
          toCurrency: to,
          rate,
          expenseRates,
        })
        from = to
      }
    }

    assert.equal(expenseRows[0]?.amount, "100.00", "amount must never be rewritten")
    assert.equal(
      expenseRows[0]?.amountInTripCurrency,
      "100.00",
      "the projection must re-anchor, not drift",
    )
  })

  it("keeps `amount * fxRate` consistent with the stored projection", async () => {
    const rows = [{ id: "e1", amount: "3200", currencyCode: "JPY", amountInTripCurrency: "3200" }]
    const { tx, updates } = makeFakeTx([], rows)
    const expenseRates = await resolveExpenseProjectionRates(["JPY"], "USD", table)
    await convertTripMoney(tx, "trip-1", {
      fromCurrency: "JPY",
      toCurrency: "USD",
      rate: (await table("JPY", "USD")) ?? 1,
      expenseRates,
    })

    const write = updates.find((u) => u.table === expenses)!
    const projected = Number(write.set.amountInTripCurrency)
    const fx = Number(write.set.fxRate)
    // Both derived fields must describe the same conversion, to the cent.
    assert.equal(projected, Math.round(3200 * fx * 100) / 100)
  })

  it("projects each currency on a mixed-currency trip from its own rate", async () => {
    const rows = [
      { id: "e1", amount: "3200", currencyCode: "JPY", amountInTripCurrency: "20.65" },
      { id: "e2", amount: "40.00", currencyCode: "USD", amountInTripCurrency: "40.00" },
    ]
    const { tx, updates } = makeFakeTx([], rows)
    const expenseRates = await resolveExpenseProjectionRates(["JPY", "USD"], "EUR", table)
    await convertTripMoney(tx, "trip-1", {
      fromCurrency: "USD",
      toCurrency: "EUR",
      rate: USD_EUR,
      expenseRates,
    })

    const written = updates
      .filter((u) => u.table === expenses)
      .map((u) => u.set.amountInTripCurrency)
    // 3200 JPY = 18.99 EUR; 40 USD = 36.80 EUR. A single trip-wide rate cannot
    // produce both, which is why this can never be one SQL statement.
    assert.deepEqual(written.toSorted(), ["18.99", "36.80"])
  })

  it("never rewrites what was actually paid, and converts the rest of the trip", async () => {
    const rows = [{ id: "e1", amount: "3200", currencyCode: "JPY", amountInTripCurrency: "3200" }]
    const { tx, updates } = makeFakeTx([{ id: "day-1" }], rows)
    const expenseRates = await resolveExpenseProjectionRates(["JPY"], "EUR", table)
    await convertTripMoney(tx, "trip-1", {
      fromCurrency: "USD",
      toCurrency: "EUR",
      rate: USD_EUR,
      expenseRates,
    })

    const write = updates.find((u) => u.table === expenses)!
    assert.ok(!("amount" in write.set), "expenses.amount must be immutable")
    assert.ok(!("currencyCode" in write.set), "expenses.currencyCode must be immutable")

    const tables = updates.map((u) => u.table)
    assert.ok(tables.includes(reservations), "reservations must be converted")
    assert.ok(tables.includes(trips), "trips must be updated")
    assert.equal(tables.filter((t) => t === activities).length, 2, "costEstimate and actualCost")
    assert.equal(updates.find((u) => u.table === trips)!.set.currencyCode, "EUR")
  })

  it("skips activity updates when the trip has no itinerary days", async () => {
    const { tx, updates } = makeFakeTx([], [])
    await convertTripMoney(tx, "trip-1", {
      fromCurrency: "USD",
      toCurrency: "EUR",
      rate: USD_EUR,
      expenseRates: new Map(),
    })
    assert.ok(!updates.some((u) => u.table === activities))
    assert.ok(updates.some((u) => u.table === reservations))
  })

  it("refuses the whole conversion when an expense currency cannot be priced", async () => {
    // GBP is absent from the resolved map — the provider could not price it, or
    // a row was inserted between resolution and the transaction. Converting the
    // rest of the trip and silently leaving this row stale is worse than failing.
    const rows = [{ id: "e1", amount: "50.00", currencyCode: "GBP", amountInTripCurrency: "50.00" }]
    const { tx } = makeFakeTx([], rows)
    await assert.rejects(
      convertTripMoney(tx, "trip-1", {
        fromCurrency: "USD",
        toCurrency: "EUR",
        rate: USD_EUR,
        expenseRates: new Map([["USD", USD_EUR]]),
      }),
      /GBP/,
    )
  })
})

describe("resolveExpenseProjectionRates", () => {
  it("maps every distinct expense currency to the target", async () => {
    const map = await resolveExpenseProjectionRates(["USD", "JPY"], "EUR", table)
    assert.equal(map.get("USD"), USD_EUR)
    assert.ok(Math.abs((map.get("JPY") ?? 0) - USD_EUR / USD_JPY) < 1e-12)
  })

  it("uses exactly 1 for the target currency itself, without calling the provider", async () => {
    let calls = 0
    const map = await resolveExpenseProjectionRates(["EUR"], "EUR", async () => {
      calls++
      return 0.5
    })
    assert.equal(map.get("EUR"), 1)
    assert.equal(calls, 0)
  })

  it("ignores unknown-provenance rows, which have no source currency to price", async () => {
    const map = await resolveExpenseProjectionRates([null, "USD"], "EUR", table)
    assert.equal(map.size, 1)
    assert.equal(map.get("USD"), USD_EUR)
  })

  it("throws when the provider cannot price a currency", async () => {
    await assert.rejects(
      resolveExpenseProjectionRates(["GBP"], "EUR", async () => null),
      /GBP/,
    )
  })
})
