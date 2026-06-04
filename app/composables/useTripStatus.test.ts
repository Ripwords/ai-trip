import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { getTripStatus } from "./useTripStatus"

describe("trip status", () => {
  it("shows cancelled before any date-derived status", () => {
    const result = getTripStatus("2026-06-10", "2026-06-15", "cancelled")

    assert.equal(result.status, "cancelled")
    assert.equal(result.label, "Cancelled")
  })

  it("still derives completed from dates for active trips", () => {
    const result = getTripStatus("2026-05-01", "2026-05-05", "upcoming", {
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(result.status, "completed")
    assert.equal(result.label, "Completed")
  })
})
