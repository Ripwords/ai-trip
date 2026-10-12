import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { FLIGHT_STATUSES, normalizeFlightStatus } from "./flight-status"

describe("normalizeFlightStatus", () => {
  it("maps AeroDataBox's status vocabulary onto the app's lowercase set", () => {
    const cases: Array<[string, string]> = [
      ["Arrived", "landed"],
      ["Canceled", "cancelled"],
      ["CanceledUncertain", "cancelled"],
      ["Delayed", "delayed"],
      ["Departed", "departed"],
      ["EnRoute", "departed"],
      ["Approaching", "departed"],
      ["Diverted", "diverted"],
      ["Expected", "scheduled"],
      ["CheckIn", "scheduled"],
      ["Boarding", "scheduled"],
      ["GateClosed", "scheduled"],
      ["Unknown", "scheduled"],
    ]
    for (const [raw, canonical] of cases) {
      assert.equal(normalizeFlightStatus(raw), canonical, raw)
    }
  })

  it("accepts both spellings of cancelled, in any case", () => {
    for (const raw of ["cancelled", "Cancelled", "CANCELED", "canceled"]) {
      assert.equal(normalizeFlightStatus(raw), "cancelled", raw)
    }
  })

  it("leaves an already-canonical status unchanged", () => {
    for (const status of FLIGHT_STATUSES) {
      assert.equal(normalizeFlightStatus(status), status)
    }
  })

  it("reads a missing status as scheduled", () => {
    assert.equal(normalizeFlightStatus(null), "scheduled")
    assert.equal(normalizeFlightStatus(undefined), "scheduled")
    assert.equal(normalizeFlightStatus(""), "scheduled")
  })
})
