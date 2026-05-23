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

  it("sums distance only for flights with known coords and rounds to km", () => {
    const result = buildPassportHistory({
      flights: [
        {
          id: "f1",
          flightNumber: "JL5",
          flightDate: "2025-03-10",
          airline: "JL",
          departureAirport: "JFK",
          arrivalAirport: "NRT",
          departureTime: null,
          arrivalTime: null,
        },
        {
          id: "f2",
          flightNumber: "XX1",
          flightDate: "2025-04-01",
          airline: "XX",
          departureAirport: "JFK",
          arrivalAirport: "ZZZ",
          departureTime: null,
          arrivalTime: null,
        },
      ],
      visitedCountries: [],
    })

    assert.ok(result.totalDistanceKm > 10000 && result.totalDistanceKm < 11500)
    assert.equal(Number.isInteger(result.totalDistanceKm), true)
    assert.equal(result.totalFlights, 2)
  })

  it("merges visited countries with flight-derived countries, visited wins", () => {
    const result = buildPassportHistory({
      flights: [
        {
          id: "f1",
          flightNumber: "JL5",
          flightDate: "2025-03-10",
          airline: "JL",
          departureAirport: "JFK",
          arrivalAirport: "NRT",
          departureTime: null,
          arrivalTime: null,
        },
        {
          id: "f2",
          flightNumber: "BA1",
          flightDate: "2025-05-01",
          airline: "BA",
          departureAirport: "LHR",
          arrivalAirport: "CDG",
          departureTime: null,
          arrivalTime: null,
        },
      ],
      visitedCountries: [
        { countryCode: "JP", countryName: "Japan", visitType: "visited" },
        { countryCode: "TH", countryName: "Thailand", visitType: "layover" },
      ],
    })

    const japan = result.countries.find((c) => c.code === "JP")
    assert.ok(japan)
    assert.equal(japan.source, "visited")

    const thailand = result.countries.find((c) => c.code === "TH")
    assert.equal(thailand?.source, "layover")

    assert.equal(result.countries.find((c) => c.code === "FR")?.source, "flight")
    assert.equal(result.countries.find((c) => c.code === "GB")?.source, "flight")

    const order = result.countries.map((c) => c.code)
    const visitedIdx = order.indexOf("JP")
    const layoverIdx = order.indexOf("TH")
    const flightIdx = Math.min(order.indexOf("FR"), order.indexOf("GB"))
    assert.ok(visitedIdx < layoverIdx)
    assert.ok(layoverIdx < flightIdx)

    assert.equal(result.countryFlags.length, result.countries.length)
  })

  it("falls back to country code when alpha2 is unknown", () => {
    const result = buildPassportHistory({
      flights: [],
      visitedCountries: [{ countryCode: "XX", countryName: "Nowhereland", visitType: "visited" }],
    })

    const entry = result.countries[0]
    assert.equal(entry?.code, "XX")
    assert.equal(entry?.name, "Nowhereland")
  })
})
