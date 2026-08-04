;(
  globalThis as { createError?: (input: { statusCode?: number; message?: string }) => Error }
).createError = (input) => Object.assign(new Error(input.message ?? ""), input)
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ExpenseRefDeps } from "./expenses"

const { assertExpenseRefs } = await import("./expenses")

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
