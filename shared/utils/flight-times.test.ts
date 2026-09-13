import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  arrivalDelayMinutes,
  blockMinutes,
  connectionMinutes,
  departureDelayMinutes,
  hasFlown,
} from "./flight-times"

const UNKNOWN = {
  scheduledDepartureTime: null,
  actualDepartureTime: null,
  scheduledArrivalTime: null,
  actualArrivalTime: null,
}

describe("departureDelayMinutes", () => {
  it("is the actual departure minus the scheduled departure", () => {
    assert.equal(
      departureDelayMinutes({
        ...UNKNOWN,
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: "2026-08-16T16:13:00Z",
      }),
      133,
    )
  })

  it("is negative when the flight pushed back early", () => {
    assert.equal(
      departureDelayMinutes({
        ...UNKNOWN,
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: "2026-08-16T13:48:00Z",
      }),
      -12,
    )
  })

  it("is null when the actual departure is unknown", () => {
    assert.equal(
      departureDelayMinutes({ ...UNKNOWN, scheduledDepartureTime: "2026-08-16T14:00:00Z" }),
      null,
    )
  })

  it("is null when the scheduled departure is unknown", () => {
    assert.equal(
      departureDelayMinutes({ ...UNKNOWN, actualDepartureTime: "2026-08-16T16:13:00Z" }),
      null,
    )
  })

  it("is null when a timestamp does not parse", () => {
    assert.equal(
      departureDelayMinutes({
        ...UNKNOWN,
        scheduledDepartureTime: "not a date",
        actualDepartureTime: "2026-08-16T16:13:00Z",
      }),
      null,
    )
  })

  it("reads Date objects and ISO strings identically", () => {
    const asStrings = departureDelayMinutes({
      ...UNKNOWN,
      scheduledDepartureTime: "2026-08-16T14:00:00Z",
      actualDepartureTime: "2026-08-16T16:13:00Z",
    })
    const asDates = departureDelayMinutes({
      ...UNKNOWN,
      scheduledDepartureTime: new Date("2026-08-16T14:00:00Z"),
      actualDepartureTime: new Date("2026-08-16T16:13:00Z"),
    })
    assert.equal(asDates, asStrings)
    assert.equal(asDates, 133)
  })
})

describe("arrivalDelayMinutes", () => {
  it("is the actual arrival minus the scheduled arrival", () => {
    assert.equal(
      arrivalDelayMinutes({
        ...UNKNOWN,
        scheduledArrivalTime: "2026-08-16T08:00:00Z",
        actualArrivalTime: "2026-08-16T08:35:00Z",
      }),
      35,
    )
  })

  it("ignores the departure pair entirely", () => {
    assert.equal(
      arrivalDelayMinutes({
        scheduledDepartureTime: "2026-08-16T01:00:00Z",
        actualDepartureTime: "2026-08-16T03:00:00Z",
        scheduledArrivalTime: "2026-08-16T08:00:00Z",
        actualArrivalTime: null,
      }),
      null,
    )
  })
})

describe("blockMinutes", () => {
  it("measures the actual pair and reports basis actual", () => {
    assert.deepEqual(
      blockMinutes({
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: "2026-08-16T16:13:00Z",
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
        actualArrivalTime: "2026-08-16T21:50:00Z",
      }),
      { minutes: 337, basis: "actual" },
    )
  })

  it("measures the scheduled pair when no actuals exist", () => {
    assert.deepEqual(
      blockMinutes({
        ...UNKNOWN,
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
      }),
      { minutes: 360, basis: "scheduled" },
    )
  })

  it("falls back to the whole scheduled pair when only the actual departure is known", () => {
    assert.deepEqual(
      blockMinutes({
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: "2026-08-16T16:13:00Z",
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
        actualArrivalTime: null,
      }),
      { minutes: 360, basis: "scheduled" },
    )
  })

  it("falls back to the whole scheduled pair when only the actual arrival is known", () => {
    assert.deepEqual(
      blockMinutes({
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: null,
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
        actualArrivalTime: "2026-08-16T21:50:00Z",
      }),
      { minutes: 360, basis: "scheduled" },
    )
  })

  it("is null when neither pair is complete", () => {
    assert.equal(
      blockMinutes({
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: null,
        scheduledArrivalTime: null,
        actualArrivalTime: "2026-08-16T21:50:00Z",
      }),
      null,
    )
  })

  it("is null when nothing is known", () => {
    assert.equal(blockMinutes(UNKNOWN), null)
  })
})

describe("hasFlown", () => {
  const LEG = {
    scheduledDepartureTime: "2026-08-16T14:00:00Z",
    actualDepartureTime: "2026-08-16T16:13:00Z",
    scheduledArrivalTime: "2026-08-16T20:00:00Z",
    actualArrivalTime: "2026-08-16T21:50:00Z",
  }

  const at = (iso: string) => Date.parse(iso)

  it("is false when the actual arrival is missing, however long ago the leg was", () => {
    assert.equal(hasFlown({ ...LEG, actualArrivalTime: null }, at("2026-09-01T00:00:00Z")), false)
  })

  it("is false when the actual departure is missing, however long ago the leg was", () => {
    assert.equal(hasFlown({ ...LEG, actualDepartureTime: null }, at("2026-09-01T00:00:00Z")), false)
  })

  it("is false for an upcoming leg that already reports both actuals", () => {
    // AeroDataBox fills `revisedTime` from the airline's own estimate the moment
    // a delay is published, days before the aircraft moves.
    assert.equal(hasFlown(LEG, at("2026-08-15T09:00:00Z")), false)
  })

  it("is false while the leg is still in the air on a flight date already past", () => {
    assert.equal(hasFlown(LEG, at("2026-08-16T21:49:00Z")), false)
  })

  it("is true the minute the leg lands, hours before the UTC day turns over", () => {
    assert.equal(hasFlown(LEG, at("2026-08-16T21:51:00Z")), true)
  })

  it("is true for a leg that landed on an earlier day", () => {
    assert.equal(hasFlown(LEG, at("2026-08-20T00:00:00Z")), true)
  })

  it("reads the wall clock when the caller names no instant", () => {
    assert.equal(hasFlown(LEG), true)
    assert.equal(hasFlown({ ...LEG, actualArrivalTime: "2999-01-01T00:00:00Z" }), false)
  })
})

describe("connectionMinutes", () => {
  const INBOUND = {
    ...UNKNOWN,
    scheduledArrivalTime: "2026-08-16T08:00:00Z",
    actualArrivalTime: "2026-08-16T08:00:00Z",
  }
  const OUTBOUND = {
    ...UNKNOWN,
    scheduledDepartureTime: "2026-08-16T14:00:00Z",
    actualDepartureTime: "2026-08-16T16:13:00Z",
  }

  it("measures the booked ground time off the scheduled clock", () => {
    assert.equal(connectionMinutes(INBOUND, OUTBOUND, "scheduled"), 360)
  })

  it("measures the ground time actually spent off the actual clock", () => {
    assert.equal(connectionMinutes(INBOUND, OUTBOUND, "actual"), 493)
  })

  it("refuses a scheduled answer when only the actual departure is known", () => {
    assert.equal(
      connectionMinutes(INBOUND, { ...OUTBOUND, scheduledDepartureTime: null }, "scheduled"),
      null,
    )
  })

  it("refuses an actual answer when only the scheduled arrival is known", () => {
    assert.equal(
      connectionMinutes({ ...INBOUND, actualArrivalTime: null }, OUTBOUND, "actual"),
      null,
    )
  })
})
