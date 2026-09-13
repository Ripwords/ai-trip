import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { compareFlightsByDeparture, departureInstant, isUpcomingFlight } from "./flight-order"

/**
 * KUL -> DXB -> LHR -> KEF out, KEF -> CDG -> DXB -> KUL back. Every connection
 * that follows a red-eye boards after local midnight, so `flightDate` (the
 * itinerary label the row was created with) names the day before the leg
 * actually departs.
 */
const itinerary = [
  { flightNumber: "EK345", flightDate: "2025-09-13", departureTime: "2025-09-13T18:13:00Z" },
  { flightNumber: "EK3", flightDate: "2025-09-13", departureTime: "2025-09-13T22:27:00Z" },
  { flightNumber: "EK3391", flightDate: "2025-09-13", departureTime: "2025-09-14T05:24:00Z" },
  { flightNumber: "EK3322", flightDate: "2025-09-23", departureTime: "2025-09-23T18:25:00Z" },
  { flightNumber: "EK76", flightDate: "2025-09-23", departureTime: "2025-09-24T07:53:00Z" },
  { flightNumber: "EK342", flightDate: "2025-09-24", departureTime: "2025-09-24T18:56:00Z" },
]

const numbers = (rows: { flightNumber: string }[]) => rows.map((r) => r.flightNumber)

describe("compareFlightsByDeparture", () => {
  it("orders a timezone-crossing itinerary by when each leg actually departs", () => {
    const shuffled = itinerary.toReversed()
    assert.deepEqual(numbers(shuffled.toSorted(compareFlightsByDeparture)), [
      "EK345",
      "EK3",
      "EK3391",
      "EK3322",
      "EK76",
      "EK342",
    ])
  })

  it("reversed, puts the most recent leg first", () => {
    const descending = itinerary.toSorted((a, b) => -compareFlightsByDeparture(a, b))
    assert.deepEqual(numbers(descending), ["EK342", "EK76", "EK3322", "EK3391", "EK3", "EK345"])
  })

  it("keeps a leg ahead of one that shares its flightDate but departs later", () => {
    const ek3391 = itinerary[2]!
    const ek3322 = itinerary[3]!
    assert.ok(compareFlightsByDeparture(ek3391, ek3322) < 0)
  })

  it("falls back to the flightDate label when the row was never given a time", () => {
    const rows = [
      { flightNumber: "B", flightDate: "2025-09-14", departureTime: null },
      { flightNumber: "A", flightDate: "2025-09-13", departureTime: null },
    ]
    assert.deepEqual(numbers(rows.toSorted(compareFlightsByDeparture)), ["A", "B"])
  })

  it("sorts an untimed row against timed rows on the same day, not to the end of the list", () => {
    const rows = [
      { flightNumber: "EK342", flightDate: "2025-09-24", departureTime: "2025-09-24T18:56:00Z" },
      { flightNumber: "UNTIMED", flightDate: "2025-09-13", departureTime: null },
      { flightNumber: "EK345", flightDate: "2025-09-13", departureTime: "2025-09-13T18:13:00Z" },
    ]
    assert.deepEqual(numbers(rows.toSorted(compareFlightsByDeparture)), [
      "UNTIMED",
      "EK345",
      "EK342",
    ])
  })

  it("is stable for rows that share a departure instant", () => {
    const rows = [
      { flightNumber: "SECOND", flightDate: "2025-09-13", departureTime: "2025-09-13T18:13:00Z" },
      { flightNumber: "FIRST", flightDate: "2025-09-13", departureTime: "2025-09-13T18:13:00Z" },
    ]
    assert.deepEqual(numbers(rows.toSorted(compareFlightsByDeparture)), ["SECOND", "FIRST"])
  })
})

describe("departureInstant", () => {
  it("reads the stored instant, not the flightDate label", () => {
    assert.equal(
      departureInstant({ flightDate: "2025-09-13", departureTime: "2025-09-14T05:24:00Z" }),
      Date.parse("2025-09-14T05:24:00Z"),
    )
  })

  it("treats an unparseable time as absent rather than producing NaN", () => {
    assert.equal(
      departureInstant({ flightDate: "2025-09-13", departureTime: "not a date" }),
      Date.parse("2025-09-13T00:00:00Z"),
    )
  })
})

describe("isUpcomingFlight", () => {
  it("keeps a red-eye that boards after midnight out of the past list", () => {
    const redEye = { flightDate: "2025-09-13", departureTime: "2025-09-14T00:30:00Z" }
    assert.equal(isUpcomingFlight(redEye, "2025-09-14"), true)
  })

  it("counts a flight that already left earlier today as still upcoming", () => {
    const earlier = { flightDate: "2025-09-14", departureTime: "2025-09-14T06:00:00Z" }
    assert.equal(isUpcomingFlight(earlier, "2025-09-14"), true)
  })

  it("counts yesterday's flight as past", () => {
    const yesterday = { flightDate: "2025-09-13", departureTime: "2025-09-13T22:27:00Z" }
    assert.equal(isUpcomingFlight(yesterday, "2025-09-14"), false)
  })
})
