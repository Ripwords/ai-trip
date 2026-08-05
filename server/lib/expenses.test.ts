;(
  globalThis as { createError?: (input: { statusCode?: number; message?: string }) => Error }
).createError = (input) => Object.assign(new Error(input.message ?? ""), input)
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ExpenseRefDeps } from "./expenses"

const { assertExpenseRefs, resolveExpenseSplits } = await import("./expenses")

const TRIP = "trip-1"

function deps(overrides: Partial<ExpenseRefDeps> = {}): ExpenseRefDeps {
  return {
    findActivityTripId: async () => TRIP,
    findTripOwnerId: async () => "owner-1",
    isActiveMember: async () => true,
    ...overrides,
  }
}

describe("assertExpenseRefs", () => {
  it("passes when both references belong to the trip", async () => {
    await assertExpenseRefs(TRIP, { activityId: "a1", paidById: "owner-1" }, deps())
  })

  it("skips checks for references that are not being set", async () => {
    let called = false
    await assertExpenseRefs(
      TRIP,
      {},
      deps({
        findActivityTripId: async () => {
          called = true
          return TRIP
        },
      }),
    )
    assert.equal(called, false)
  })

  it("allows clearing a reference with null", async () => {
    await assertExpenseRefs(TRIP, { activityId: null, paidById: null }, deps())
  })

  // The PUT handler performed neither of these checks while accepting both
  // fields, so an editor could point an expense at another trip's activity.
  it("rejects an activity belonging to a different trip", async () => {
    await assert.rejects(
      () =>
        assertExpenseRefs(
          TRIP,
          { activityId: "a1" },
          deps({ findActivityTripId: async () => "other-trip" }),
        ),
      /Activity not found/,
    )
  })

  it("rejects an activity that does not exist", async () => {
    await assert.rejects(
      () =>
        assertExpenseRefs(
          TRIP,
          { activityId: "nope" },
          deps({ findActivityTripId: async () => null }),
        ),
      /Activity not found/,
    )
  })

  it("rejects a payer who is not a member of the trip", async () => {
    await assert.rejects(
      () =>
        assertExpenseRefs(
          TRIP,
          { paidById: "stranger" },
          deps({ isActiveMember: async () => false }),
        ),
      /not a member of this trip/,
    )
  })

  it("accepts the trip owner as a payer without a membership row", async () => {
    await assertExpenseRefs(
      TRIP,
      { paidById: "owner-1" },
      // Owners have no tripMembers row; a membership lookup would reject them.
      deps({ isActiveMember: async () => false }),
    )
  })

  it("rejects when the trip does not exist", async () => {
    await assert.rejects(
      () =>
        assertExpenseRefs(
          TRIP,
          { paidById: "someone" },
          deps({ findTripOwnerId: async () => null }),
        ),
      /Trip not found/,
    )
  })
})

// Issue #35: `expenses.splits` was dead — the tracker hardcoded an equal split
// across every active member. These cover turning a request body into the
// resolved per-participant amounts the column was always meant to hold.
describe("resolveExpenseSplits", () => {
  const memberIds = ["a", "b", "c"]

  it("stores null for an equal split across everyone", () => {
    // Null means "equal across whoever is on the trip at read time", which is
    // the right answer when the user never narrowed the participant set.
    assert.equal(
      resolveExpenseSplits({ amount: "90.00", currencyCode: "USD", splitMode: "equal", memberIds }),
      null,
    )
  })

  it("stores explicit amounts once the participant set is narrowed", () => {
    assert.deepEqual(
      resolveExpenseSplits({
        amount: "90.00",
        currencyCode: "USD",
        splitMode: "equal",
        participantIds: ["a", "b"],
        memberIds,
      }),
      { a: "45.00", b: "45.00" },
    )
  })

  it("reconciles an equal split that does not divide evenly", () => {
    assert.deepEqual(
      resolveExpenseSplits({
        amount: "100.00",
        currencyCode: "USD",
        splitMode: "equal",
        participantIds: memberIds,
        memberIds,
      }),
      { a: "33.34", b: "33.33", c: "33.33" },
    )
  })

  it("resolves shares and percent modes", () => {
    assert.deepEqual(
      resolveExpenseSplits({
        amount: "120.00",
        currencyCode: "USD",
        splitMode: "shares",
        participantIds: ["a", "b"],
        splitValues: { a: 2, b: 1 },
        memberIds,
      }),
      { a: "80.00", b: "40.00" },
    )
    assert.deepEqual(
      resolveExpenseSplits({
        amount: "200.00",
        currencyCode: "USD",
        splitMode: "percent",
        participantIds: ["a", "b"],
        splitValues: { a: 25, b: 75 },
        memberIds,
      }),
      { a: "50.00", b: "150.00" },
    )
  })

  it("takes exact-mode values in major units and requires them to reconcile", () => {
    assert.deepEqual(
      resolveExpenseSplits({
        amount: "50.00",
        currencyCode: "USD",
        splitMode: "exact",
        participantIds: ["a", "b"],
        splitValues: { a: 35, b: 15 },
        memberIds,
      }),
      { a: "35.00", b: "15.00" },
    )
    assert.throws(
      () =>
        resolveExpenseSplits({
          amount: "50.00",
          currencyCode: "USD",
          splitMode: "exact",
          participantIds: ["a", "b"],
          splitValues: { a: 35, b: 10 },
          memberIds,
        }),
      /must sum to/i,
    )
  })

  it("respects a zero-decimal currency", () => {
    assert.deepEqual(
      resolveExpenseSplits({
        amount: "3000",
        currencyCode: "JPY",
        splitMode: "equal",
        participantIds: ["a", "b", "c"],
        memberIds,
      }),
      { a: "1000", b: "1000", c: "1000" },
    )
  })

  it("rejects a participant who is not a member of the trip", () => {
    assert.throws(
      () =>
        resolveExpenseSplits({
          amount: "50.00",
          currencyCode: "USD",
          splitMode: "equal",
          participantIds: ["a", "ghost"],
          memberIds,
        }),
      /not a member/i,
    )
  })

  it("rejects an amount that is not money", () => {
    assert.throws(
      () =>
        resolveExpenseSplits({
          amount: "oops",
          currencyCode: "USD",
          splitMode: "equal",
          participantIds: ["a"],
          memberIds,
        }),
      /amount/i,
    )
  })
})
