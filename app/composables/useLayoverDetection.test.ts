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
      arrivalTimeLocal: "2026-08-16 03:00+08:00",
    }),
    flight({
      id: "f2",
      departureAirport: "SIN",
      arrivalAirport: "HND",
      departureTime: "2026-08-16T01:00:00.000Z",
    }),
  ]
}

function layovers(items: FlightItem[]): LayoverInfo[] {
  const { flightListItems } = useLayoverDetection(ref(items))
  return flightListItems.value.filter((i): i is LayoverInfo => i.type === "layover")
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
