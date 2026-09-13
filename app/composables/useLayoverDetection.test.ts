import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ref } from "vue"
import { useLayoverDetection, type FlightItem, type LayoverInfo } from "./useLayoverDetection"

function flight(overrides: Partial<FlightItem> & Pick<FlightItem, "id">): FlightItem {
  return {
    flightNumber: "XX000",
    flightDate: "2026-08-16",
    departureAirport: null,
    arrivalAirport: null,
    departureTime: null,
    arrivalTime: null,
    arrivalTimeLocal: null,
    scheduledDepartureTime: null,
    actualDepartureTime: null,
    scheduledArrivalTime: null,
    actualArrivalTime: null,
    ...overrides,
  }
}

/** SIN connection: lands 03:00 local (19:00Z the previous day), leaves 09:00 local. */
function sinConnection(): FlightItem[] {
  return [
    flight({
      id: "f1",
      departureAirport: "KUL",
      arrivalAirport: "SIN",
      // The DB column is `timestamp with timezone`, so this is what the client sees.
      arrivalTime: "2026-08-15T19:00:00.000Z",
      scheduledArrivalTime: "2026-08-15T19:00:00.000Z",
      arrivalTimeLocal: "2026-08-16 03:00+08:00",
    }),
    flight({
      id: "f2",
      departureAirport: "SIN",
      arrivalAirport: "HND",
      departureTime: "2026-08-16T01:00:00.000Z",
      scheduledDepartureTime: "2026-08-16T01:00:00.000Z",
    }),
  ]
}

function layovers(items: FlightItem[], nowIso = "2026-09-01T00:00:00Z"): LayoverInfo[] {
  const { flightListItems } = useLayoverDetection(ref(items), Date.parse(nowIso))
  return flightListItems.value.filter((i): i is LayoverInfo => i.type === "layover")
}

/**
 * The reported case. A 6h00m booking at CDG where the onward EK76 pushed back
 * 2h13m; the inbound landed on schedule.
 */
function cdgConnection(): FlightItem[] {
  return [
    flight({
      id: "ek343",
      flightNumber: "EK343",
      departureAirport: "DXB",
      arrivalAirport: "CDG",
      departureTime: "2026-08-16T02:00:00.000Z",
      arrivalTime: "2026-08-16T08:00:00.000Z",
      scheduledDepartureTime: "2026-08-16T02:00:00.000Z",
      actualDepartureTime: "2026-08-16T02:00:00.000Z",
      scheduledArrivalTime: "2026-08-16T08:00:00.000Z",
      actualArrivalTime: "2026-08-16T08:00:00.000Z",
    }),
    flight({
      id: "ek76",
      flightNumber: "EK76",
      departureAirport: "CDG",
      arrivalAirport: "DXB",
      departureTime: "2026-08-16T16:13:00.000Z",
      arrivalTime: "2026-08-16T22:10:00.000Z",
      scheduledDepartureTime: "2026-08-16T14:00:00.000Z",
      actualDepartureTime: "2026-08-16T16:13:00.000Z",
      scheduledArrivalTime: "2026-08-16T20:00:00.000Z",
      actualArrivalTime: "2026-08-16T22:10:00.000Z",
    }),
  ]
}

describe("useLayoverDetection", () => {
  it("detects the connection", () => {
    assert.equal(layovers(sinConnection()).length, 1)
  })

  it("detects the same connection when the list runs newest-first", () => {
    // The past-flights lists are rendered most recent first, so the leg that
    // lands at the transfer airport sits *below* the one that leaves it.
    const [layover] = layovers(sinConnection().toReversed())
    assert.equal(layover?.airport, "SIN")
    assert.equal(layover?.arrivalFlight.id, "f1")
    assert.equal(layover?.departureFlight.id, "f2")
    assert.equal(layover?.durationMinutes, 360)
  })

  it("places the newest-first layover card between the two legs", () => {
    const { flightListItems } = useLayoverDetection(ref(sinConnection().toReversed()))
    assert.deepEqual(
      flightListItems.value.map((i) => (i.type === "layover" ? "layover" : i.flight.id)),
      ["f2", "layover", "f1"],
    )
  })

  it("carries the airport-local arrival wall clock, not just the UTC instant (issue #15)", () => {
    // The layover-tips prompt and its 30-day cache key are bucketed off this.
    // Only the UTC instant used to reach the endpoint, so the server had to guess
    // the local hour from its own timezone.
    const [layover] = layovers(sinConnection())
    assert.equal(layover?.arrivalTimeLocal, "2026-08-16 03:00+08:00")
  })

  it("degrades to null when the airline API never gave a local time", () => {
    const flights = sinConnection()
    flights[0] = flight({ ...flights[0]!, arrivalTimeLocal: null })
    const [layover] = layovers(flights)
    assert.equal(layover?.arrivalTimeLocal, null)
  })

  it("marks the arriving leg as the one whose visa badge the layover card carries", () => {
    const { layoverCoveredFlightIds } = useLayoverDetection(ref(sinConnection().toReversed()))
    assert.deepEqual([...layoverCoveredFlightIds.value], ["f1"])
  })
})

describe("a booked 6h layover at CDG whose onward leg pushed back 2h13m", () => {
  it("reports the booked and the real ground time, each off its own clock", () => {
    const [layover] = layovers(cdgConnection(), "2026-08-20T00:00:00Z")
    assert.equal(layover?.scheduledMinutes, 360)
    assert.equal(layover?.actualMinutes, 493)
  })

  it("never headlines a figure that came from neither clock", () => {
    // The legacy columns coalesce each end independently, so a leg that landed
    // 20m early ahead of a delayed onward departure yields 493 minutes: a booked
    // arrival minus a real departure, a span the traveler neither booked nor
    // spent. Only 360 (booked) and 513 (real) are sayable.
    const flights = cdgConnection()
    flights[0] = flight({ ...flights[0]!, actualArrivalTime: "2026-08-16T07:40:00.000Z" })

    for (const nowIso of ["2026-08-10T00:00:00Z", "2026-08-20T00:00:00Z"]) {
      const [layover] = layovers(flights, nowIso)
      assert.ok(
        layover?.durationMinutes === 360 || layover?.durationMinutes === 513,
        `headlined ${layover?.durationMinutes} on ${nowIso}`,
      )
    }
  })

  it("headlines the real ground time and drops the advice once both legs have flown", () => {
    const [layover] = layovers(cdgConnection(), "2026-08-20T00:00:00Z")
    assert.equal(layover?.retrospective, true)
    assert.equal(layover?.durationMinutes, 493)
    assert.equal(layover?.basis, "actual")
    assert.equal(layover?.recommendation, null)
    assert.equal(layover?.recommendationLabel, null)
  })

  it("headlines the booking while the legs are still upcoming", () => {
    const [layover] = layovers(cdgConnection(), "2026-08-10T00:00:00Z")
    assert.equal(layover?.retrospective, false)
    assert.equal(layover?.durationMinutes, 360)
    assert.equal(layover?.basis, "scheduled")
    assert.equal(layover?.recommendationLabel, "Go explore!")
  })

  it("is not retrospective merely because the airline published its delay", () => {
    // Both legs carry actuals a week out; nothing has flown.
    const [layover] = layovers(cdgConnection(), "2026-08-10T00:00:00Z")
    assert.equal(layover?.retrospective, false)
  })

  it("advises off the booked figure, not off the delay", () => {
    const flights = cdgConnection()
    flights[1] = flight({
      ...flights[1]!,
      scheduledDepartureTime: "2026-08-16T10:50:00.000Z",
      actualDepartureTime: "2026-08-16T13:03:00.000Z",
      departureTime: "2026-08-16T13:03:00.000Z",
    })
    const [layover] = layovers(flights, "2026-08-10T00:00:00Z")
    assert.equal(layover?.scheduledMinutes, 170)
    assert.equal(layover?.actualMinutes, 303)
    assert.equal(layover?.recommendationLabel, "Stay in airport")
  })
})
