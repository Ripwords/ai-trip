import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { computeBudgetRollup } from "./budget-rollup"

describe("computeBudgetRollup", () => {
  it("sums expenses and bookings into one committed total", () => {
    const rollup = computeBudgetRollup({
      expenses: [{ amount: "120.50" }, { amount: "9.50" }],
      reservations: [{ amount: "900.00", status: "confirmed" }],
    })

    assert.equal(rollup.expenses, 130)
    assert.equal(rollup.bookings, 900)
    assert.equal(rollup.total, 1030)
  })

  // The bug this closes: a €900 hotel booking left the budget bar untouched.
  it("counts a booking amount that no expense mirrors", () => {
    const rollup = computeBudgetRollup({
      expenses: [],
      reservations: [{ amount: "900.00", status: "confirmed" }],
    })

    assert.equal(rollup.total, 900)
  })

  it("ignores cancelled bookings — a cancelled hotel isn't money committed", () => {
    const rollup = computeBudgetRollup({
      expenses: [],
      reservations: [
        { amount: "900.00", status: "cancelled" },
        { amount: "100.00", status: "pending" },
      ],
    })

    assert.equal(rollup.bookings, 100)
  })

  it("skips rows with no amount", () => {
    const rollup = computeBudgetRollup({
      expenses: [{ amount: null }],
      reservations: [{ amount: null, status: "confirmed" }],
    })

    assert.equal(rollup.total, 0)
  })

  // `amount` is a numeric column read back as a string; a malformed one used to
  // turn the whole total into NaN and blank the budget bar.
  it("skips unparseable amounts instead of poisoning the total", () => {
    const rollup = computeBudgetRollup({
      expenses: [{ amount: "abc" }, { amount: "10.00" }],
      reservations: [{ amount: "", status: "confirmed" }],
    })

    assert.equal(rollup.total, 10)
  })

  it("is zero for an empty trip", () => {
    const rollup = computeBudgetRollup({ expenses: [], reservations: [] })
    assert.deepEqual(rollup, { expenses: 0, bookings: 0, total: 0 })
  })
})
