/**
 * The PDF's money maths — issue #38, still open because of this file.
 *
 * The export summed `amount` across every expense and printed the result in the
 * trip's currency: a EUR trip with a €40 dinner and a ¥3,200 lunch printed
 * "Spent: €3,240.00 / Over budget" while the app itself showed €60.64. `amount`
 * is per-expense currency (#47), so the only column that may ever be added up
 * is the trip-currency projection.
 *
 * Only the arithmetic is under test here: the rest of `downloadPdf` is string
 * templating around `window.open`.
 */

import assert from "node:assert/strict"
import { describe, it } from "bun:test"

import { summarisePdfExpenses, type PdfExpense } from "./useExportPdf"

function expense(overrides: Partial<PdfExpense> = {}): PdfExpense {
  return {
    description: "Dinner",
    amount: "40.00",
    currencyCode: "EUR",
    amountInTripCurrency: "40.00",
    category: "food",
    paidAt: "2026-08-04",
    ...overrides,
  }
}

/** €40 paid in EUR, plus ¥3,200 that converts to €20.64. */
function mixedCurrencyTrip(): PdfExpense[] {
  return [
    expense(),
    expense({
      description: "Lunch",
      amount: "3200",
      currencyCode: "JPY",
      amountInTripCurrency: "20.64",
    }),
  ]
}

describe("summarisePdfExpenses", () => {
  it("totals the trip-currency projection, never the paid amounts", () => {
    const summary = summarisePdfExpenses(mixedCurrencyTrip(), "EUR", null)
    assert.equal(summary.total, "60.64")
  })

  it("breaks categories down in the trip currency too", () => {
    const summary = summarisePdfExpenses(
      [
        ...mixedCurrencyTrip(),
        expense({ description: "Museum", category: "activities", amountInTripCurrency: "39.36" }),
      ],
      "EUR",
      null,
    )
    const food = summary.byCategory.find((row) => row.category === "food")
    const activities = summary.byCategory.find((row) => row.category === "activities")
    assert.equal(food?.amount, "60.64")
    assert.equal(activities?.amount, "39.36")
    // Largest first, and the percentages are of the converted total.
    assert.equal(summary.byCategory[0]?.category, "food")
    assert.equal(activities?.percent, 39)
  })

  it("measures the budget against the converted spend, not the mixed sum", () => {
    const summary = summarisePdfExpenses(mixedCurrencyTrip(), "EUR", "100.00")
    assert.equal(summary.budget?.isOver, false)
    assert.equal(summary.budget?.remaining, "39.36")
  })

  it("reports over-budget as a positive overspend", () => {
    const summary = summarisePdfExpenses(mixedCurrencyTrip(), "EUR", "50.00")
    assert.equal(summary.budget?.isOver, true)
    assert.equal(summary.budget?.remaining, "10.64")
  })

  it("adds up a zero-decimal trip currency in whole units", () => {
    const summary = summarisePdfExpenses(
      [
        expense({ amount: "20.00", currencyCode: "USD", amountInTripCurrency: "3000" }),
        expense({ amount: "1200", currencyCode: "JPY", amountInTripCurrency: "1200" }),
      ],
      "JPY",
      null,
    )
    assert.equal(summary.total, "4200")
  })

  it("counts a legacy row of unknown provenance at its projected value", () => {
    const summary = summarisePdfExpenses(
      [expense({ currencyCode: null, amount: "40.00", amountInTripCurrency: "40.00" })],
      "EUR",
      null,
    )
    assert.equal(summary.total, "40.00")
  })

  it("has no budget line when the trip has no budget", () => {
    assert.equal(summarisePdfExpenses(mixedCurrencyTrip(), "EUR", null).budget, null)
  })
})
