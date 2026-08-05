import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { SummariseTripExpensesInput } from "./expense-summary"

const { summariseTripExpenses } = await import("./expense-summary")

const members = [
  { userId: "a", user: { name: "Alice" } },
  { userId: "b", user: { name: "Bob" } },
]

function input(overrides: Partial<SummariseTripExpensesInput> = {}): SummariseTripExpensesInput {
  return {
    tripCurrencyCode: "USD",
    budget: null,
    startDate: "2026-03-01",
    endDate: "2026-03-05",
    today: "2026-03-03",
    expenses: [],
    activities: [],
    reservations: [],
    members,
    ...overrides,
  }
}

const expense = (over: Partial<SummariseTripExpensesInput["expenses"][number]> = {}) => ({
  id: "e1",
  amount: "10.00",
  category: "food",
  paidAt: "2026-03-01",
  paidById: "a",
  activityId: null,
  splits: null,
  ...over,
})

describe("summariseTripExpenses — the one true total", () => {
  // Issue #38: ExpenseTracker summed expenses, TripStats summed activity
  // estimates, TripOverview summed expenses again — three different answers to
  // "what does this trip cost", none of which counted reservations.
  it("counts expenses and reservations as spend, and estimates as planned", () => {
    const s = summariseTripExpenses(
      input({
        expenses: [expense({ amount: "40.00" })],
        reservations: [{ amount: "60.00" }, { amount: null }],
        activities: [
          { id: "act1", name: "Museum", dayNumber: 1, date: "2026-03-01", costEstimate: "25.00" },
        ],
      }),
    )
    assert.equal(s.expensesTotal, 40)
    assert.equal(s.reservationsTotal, 60)
    assert.equal(s.total, 100)
    assert.equal(s.plannedTotal, 25)
  })

  it("adds cents without float drift", () => {
    const s = summariseTripExpenses(
      input({
        expenses: Array.from({ length: 10 }, (_, i) => expense({ id: `e${i}`, amount: "0.10" })),
      }),
    )
    assert.equal(s.expensesTotal, 1)
  })
})

describe("summariseTripExpenses — budget", () => {
  it("reports what is left and how much is used", () => {
    const s = summariseTripExpenses(
      input({ budget: "500.00", expenses: [expense({ amount: "125.00" })] }),
    )
    assert.equal(s.budget, 500)
    assert.equal(s.remaining, 375)
    assert.equal(s.budgetPercent, 25)
  })

  it("reports a null budget rather than pretending it is zero", () => {
    const s = summariseTripExpenses(input({ expenses: [expense()] }))
    assert.equal(s.budget, null)
    assert.equal(s.remaining, null)
    assert.equal(s.budgetPercent, null)
  })

  it("goes negative when the trip is over budget", () => {
    const s = summariseTripExpenses(
      input({ budget: "100.00", expenses: [expense({ amount: "150.00" })] }),
    )
    assert.equal(s.remaining, -50)
    assert.equal(s.budgetPercent, 150)
  })
})

describe("summariseTripExpenses — breakdowns", () => {
  it("groups by category, largest first", () => {
    const s = summariseTripExpenses(
      input({
        expenses: [
          expense({ id: "1", category: "food", amount: "10.00" }),
          expense({ id: "2", category: "transport", amount: "30.00" }),
          expense({ id: "3", category: "food", amount: "5.00" }),
        ],
      }),
    )
    assert.deepEqual(s.byCategory, [
      { category: "transport", amount: 30 },
      { category: "food", amount: 15 },
    ])
  })

  it("groups by day in date order and buckets undated spend separately", () => {
    const s = summariseTripExpenses(
      input({
        expenses: [
          expense({ id: "1", paidAt: "2026-03-02", amount: "20.00" }),
          expense({ id: "2", paidAt: "2026-03-01", amount: "10.00" }),
          expense({ id: "3", paidAt: null, amount: "7.00" }),
        ],
      }),
    )
    assert.deepEqual(s.byDay, [
      { date: "2026-03-01", amount: 10 },
      { date: "2026-03-02", amount: 20 },
    ])
    assert.equal(s.undatedTotal, 7)
  })

  it("groups by payer and names them", () => {
    const s = summariseTripExpenses(
      input({
        expenses: [
          expense({ id: "1", paidById: "a", amount: "10.00" }),
          expense({ id: "2", paidById: "b", amount: "30.00" }),
          expense({ id: "3", paidById: null, amount: "5.00" }),
        ],
      }),
    )
    assert.deepEqual(s.byPayer, [
      { userId: "b", name: "Bob", amount: 30 },
      { userId: "a", name: "Alice", amount: 10 },
    ])
  })
})

describe("summariseTripExpenses — burn rate", () => {
  it("divides spend by elapsed days and projects over the whole trip", () => {
    // 2026-03-01..05 is a 5-day trip; on the 3rd, 3 days have elapsed.
    const s = summariseTripExpenses(
      input({ today: "2026-03-03", expenses: [expense({ amount: "90.00" })] }),
    )
    assert.equal(s.tripDays, 5)
    assert.equal(s.elapsedDays, 3)
    assert.equal(s.burnRatePerDay, 30)
    assert.equal(s.projectedTotal, 150)
  })

  it("uses the whole trip once it is over", () => {
    const s = summariseTripExpenses(
      input({ today: "2026-04-01", expenses: [expense({ amount: "100.00" })] }),
    )
    assert.equal(s.elapsedDays, 5)
    assert.equal(s.burnRatePerDay, 20)
    assert.equal(s.projectedTotal, 100)
  })

  it("does not divide by zero before the trip starts", () => {
    const s = summariseTripExpenses(
      input({ today: "2026-01-01", expenses: [expense({ amount: "100.00" })] }),
    )
    assert.equal(s.elapsedDays, 0)
    assert.equal(s.burnRatePerDay, 0)
    // Nothing has elapsed, so there is no rate to extrapolate — report what is
    // actually spent rather than a made-up projection.
    assert.equal(s.projectedTotal, 100)
  })
})

// Issue #39: `expenses.activityId` had a column, an index and a relation, and
// no code path ever set or read it, so estimated and actual cost never met.
describe("summariseTripExpenses — planned vs actual", () => {
  const activities = [
    { id: "act1", name: "Museum", dayNumber: 1, date: "2026-03-01", costEstimate: "25.00" },
    { id: "act2", name: "Sushi", dayNumber: 2, date: "2026-03-02", costEstimate: "80.00" },
    { id: "act3", name: "Park", dayNumber: 2, date: "2026-03-02", costEstimate: null },
  ]

  it("pairs each activity's estimate with the expenses linked to it", () => {
    const s = summariseTripExpenses(
      input({
        activities,
        expenses: [
          expense({ id: "1", activityId: "act1", amount: "30.00" }),
          expense({ id: "2", activityId: "act2", amount: "45.00" }),
          expense({ id: "3", activityId: "act2", amount: "20.00" }),
        ],
      }),
    )
    assert.deepEqual(s.plannedVsActual, [
      {
        activityId: "act1",
        name: "Museum",
        dayNumber: 1,
        date: "2026-03-01",
        planned: 25,
        actual: 30,
        variance: 5,
      },
      {
        activityId: "act2",
        name: "Sushi",
        dayNumber: 2,
        date: "2026-03-02",
        planned: 80,
        actual: 65,
        variance: -15,
      },
    ])
  })

  it("omits activities with neither an estimate nor a linked expense", () => {
    const s = summariseTripExpenses(input({ activities }))
    assert.deepEqual(
      s.plannedVsActual.map((p) => p.activityId),
      ["act1", "act2"],
    )
  })

  it("includes an activity that has spend but no estimate", () => {
    const s = summariseTripExpenses(
      input({
        activities,
        expenses: [expense({ id: "1", activityId: "act3", amount: "12.00" })],
      }),
    )
    const park = s.plannedVsActual.find((p) => p.activityId === "act3")!
    assert.deepEqual(park, {
      activityId: "act3",
      name: "Park",
      dayNumber: 2,
      date: "2026-03-02",
      planned: 0,
      actual: 12,
      variance: 12,
    })
  })

  it("totals how much spend is attached to the itinerary versus loose", () => {
    const s = summariseTripExpenses(
      input({
        activities,
        expenses: [
          expense({ id: "1", activityId: "act1", amount: "30.00" }),
          expense({ id: "2", activityId: null, amount: "20.00" }),
        ],
      }),
    )
    assert.equal(s.linkedToActivitiesTotal, 30)
    assert.equal(s.unlinkedTotal, 20)
  })

  it("ignores an activityId that points at nothing on this trip", () => {
    const s = summariseTripExpenses(
      input({ activities, expenses: [expense({ activityId: "gone" })] }),
    )
    assert.deepEqual(s.plannedVsActual.map((p) => p.activityId).toSorted(), ["act1", "act2"])
  })
})

describe("summariseTripExpenses — settlement", () => {
  it("carries the settlement so every surface reads the same balances", () => {
    const s = summariseTripExpenses(
      input({
        expenses: [expense({ amount: "100.00", paidById: "a" })],
      }),
    )
    assert.deepEqual(
      s.settlement.balances.map((b) => [b.userId, b.balance]),
      [
        ["a", 50],
        ["b", -50],
      ],
    )
    assert.equal(s.settlement.transfers.length, 1)
  })
})

describe("summariseTripExpenses — empty trip", () => {
  it("returns zeroes rather than NaN", () => {
    const s = summariseTripExpenses(input())
    assert.equal(s.total, 0)
    assert.equal(s.expensesTotal, 0)
    assert.equal(s.burnRatePerDay, 0)
    assert.equal(s.projectedTotal, 0)
    assert.deepEqual(s.byCategory, [])
    assert.deepEqual(s.plannedVsActual, [])
  })
})
