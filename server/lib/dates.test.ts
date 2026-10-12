import assert from "node:assert/strict"
import { describe, it } from "bun:test"
import { resolveTripDateRange } from "./dates"

const stored = { startDate: "2026-03-20", endDate: "2026-03-25" }

const isBadRequest = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 400

describe("resolveTripDateRange", () => {
  it("merges a partial update with the stored other date", () => {
    assert.deepEqual(resolveTripDateRange(stored, { startDate: "2026-03-22" }), {
      startDate: "2026-03-22",
      endDate: "2026-03-25",
    })
    assert.deepEqual(resolveTripDateRange(stored, {}), stored)
  })

  // B11: only `startDate` was sent, so the schema's both-present refine never
  // ran, and a start after the stored end enumerated zero days — deleting
  // every day of the trip.
  it("rejects a start-only update that lands after the stored end with a 400", () => {
    assert.throws(() => resolveTripDateRange(stored, { startDate: "2026-04-01" }), isBadRequest)
  })

  it("rejects an end-only update that lands before the stored start with a 400", () => {
    assert.throws(() => resolveTripDateRange(stored, { endDate: "2026-03-01" }), isBadRequest)
  })

  it("allows a single-day trip", () => {
    assert.deepEqual(resolveTripDateRange(stored, { startDate: "2026-03-25" }), {
      startDate: "2026-03-25",
      endDate: "2026-03-25",
    })
  })
})
