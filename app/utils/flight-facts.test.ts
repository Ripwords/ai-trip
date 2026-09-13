import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { delayNotes, formatDuration, layoverFactLine } from "./flight-facts"

const UNKNOWN = {
  scheduledDepartureTime: null,
  actualDepartureTime: null,
  scheduledArrivalTime: null,
  actualArrivalTime: null,
}

describe("formatDuration", () => {
  it("drops the hours below an hour", () => {
    assert.equal(formatDuration(45), "45m")
  })

  it("drops the minutes on a whole hour", () => {
    assert.equal(formatDuration(360), "6h")
  })

  it("writes both parts otherwise", () => {
    assert.equal(formatDuration(493), "8h 13m")
  })

  it("formats a negative span as its magnitude", () => {
    assert.equal(formatDuration(-133), "2h 13m")
  })
})

describe("layoverFactLine", () => {
  const BASE = {
    scheduledMinutes: 360,
    inboundFlightNumber: "EK343",
    inboundArrivalDelayMinutes: null,
    outboundFlightNumber: "EK76",
    outboundDepartureDelayMinutes: null,
  }

  it("states the booked time beside the leg that slipped", () => {
    assert.equal(
      layoverFactLine({ ...BASE, outboundDepartureDelayMinutes: 133 }),
      "Booked 6h · EK76 left 2h 13m late",
    )
  })

  it("names both legs when both slipped", () => {
    assert.equal(
      layoverFactLine({
        ...BASE,
        inboundArrivalDelayMinutes: 20,
        outboundDepartureDelayMinutes: 133,
      }),
      "Booked 6h · EK343 landed 20m late · EK76 left 2h 13m late",
    )
  })

  it("says early when a leg ran ahead of schedule", () => {
    assert.equal(
      layoverFactLine({ ...BASE, inboundArrivalDelayMinutes: -20 }),
      "Booked 6h · EK343 landed 20m early",
    )
  })

  it("omits the booked clause when the booked time is unknown", () => {
    assert.equal(
      layoverFactLine({ ...BASE, scheduledMinutes: null, outboundDepartureDelayMinutes: 133 }),
      "EK76 left 2h 13m late",
    )
  })

  it("drops a delay of exactly zero rather than calling it 0m late", () => {
    assert.equal(
      layoverFactLine({
        ...BASE,
        inboundArrivalDelayMinutes: 0,
        outboundDepartureDelayMinutes: 0,
      }),
      "Booked 6h",
    )
  })

  it("is null when nothing factual survives", () => {
    assert.equal(layoverFactLine({ ...BASE, scheduledMinutes: null }), null)
  })
})

describe("delayNotes", () => {
  it("reports the departure before the arrival", () => {
    assert.deepEqual(
      delayNotes({
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: "2026-08-16T16:13:00Z",
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
        actualArrivalTime: "2026-08-16T21:50:00Z",
      }),
      [
        {
          label: "Left 2h 13m late",
          scheduledTime: "2026-08-16T14:00:00.000Z",
          tone: "late",
        },
        {
          label: "Landed 1h 50m late",
          scheduledTime: "2026-08-16T20:00:00.000Z",
          tone: "late",
        },
      ],
    )
  })

  it("reports only the end that moved", () => {
    assert.deepEqual(
      delayNotes({
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        actualDepartureTime: "2026-08-16T14:00:00Z",
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
        actualArrivalTime: "2026-08-16T19:40:00Z",
      }),
      [
        {
          label: "Landed 20m early",
          scheduledTime: "2026-08-16T20:00:00.000Z",
          tone: "early",
        },
      ],
    )
  })

  it("is empty when no actual is known", () => {
    assert.deepEqual(
      delayNotes({
        ...UNKNOWN,
        scheduledDepartureTime: "2026-08-16T14:00:00Z",
        scheduledArrivalTime: "2026-08-16T20:00:00Z",
      }),
      [],
    )
  })

  it("reads Date columns the same as ISO strings", () => {
    assert.deepEqual(
      delayNotes({
        ...UNKNOWN,
        scheduledDepartureTime: new Date("2026-08-16T14:00:00Z"),
        actualDepartureTime: new Date("2026-08-16T16:13:00Z"),
      }),
      [
        {
          label: "Left 2h 13m late",
          scheduledTime: "2026-08-16T14:00:00.000Z",
          tone: "late",
        },
      ],
    )
  })
})
