import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildPassportHistory } from "./passport-history"

describe("passport history", () => {
  it("counts flights and unique airports/airlines", () => {
    const result = buildPassportHistory({
      flights: [
        {
          id: "f1",
          flightNumber: "JL5",
          flightDate: "2025-03-10",
          airline: "Japan Airlines",
          departureAirport: "JFK",
          arrivalAirport: "NRT",
          departureTime: null,
          arrivalTime: null,
        },
        {
          id: "f2",
          flightNumber: "JL6",
          flightDate: "2025-03-20",
          airline: "Japan Airlines",
          departureAirport: "NRT",
          arrivalAirport: "JFK",
          departureTime: null,
          arrivalTime: null,
        },
      ],
      visitedCountries: [],
    })

    assert.equal(result.totalFlights, 2)
    assert.deepEqual(result.uniqueAirports.toSorted(), ["JFK", "NRT"])
    assert.deepEqual(result.uniqueAirlines, ["Japan Airlines"])
  })
})
