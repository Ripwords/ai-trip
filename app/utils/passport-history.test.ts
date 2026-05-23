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

  it("builds country list from visited-countries only — ignores flight-derived countries", () => {
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

    // France/UK/US should NOT appear — they are flight-derived only.
    assert.equal(
      result.countries.find((c) => c.code === "FR"),
      undefined,
    )
    assert.equal(
      result.countries.find((c) => c.code === "GB"),
      undefined,
    )
    assert.equal(
      result.countries.find((c) => c.code === "US"),
      undefined,
    )

    // Visited group ordered before layover group.
    const order = result.countries.map((c) => c.code)
    assert.deepEqual(order, ["JP", "TH"])

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

  it("returns up to N most-recent flights, newest first", () => {
    const result = buildPassportHistory({
      flights: [
        mkFlight("f-old", "2023-01-10", "JFK", "LHR"),
        mkFlight("f-mid", "2024-06-15", "JFK", "CDG"),
        mkFlight("f-new", "2025-09-20", "JFK", "NRT"),
        mkFlight("f-newer", "2025-12-01", "JFK", "HND"),
        mkFlight("f-newest", "2026-02-02", "JFK", "ICN"),
      ],
      visitedCountries: [],
      recentFlightLimit: 3,
    })

    assert.deepEqual(
      result.recentFlights.map((f) => f.id),
      ["f-newest", "f-newer", "f-new"],
    )
  })

  it("filters flight stats by year while keeping visited countries visible", () => {
    const all = buildPassportHistory({
      flights: [
        mkFlight("a", "2024-03-01", "JFK", "NRT"),
        mkFlight("b", "2025-05-01", "JFK", "CDG"),
      ],
      visitedCountries: [{ countryCode: "TH", countryName: "Thailand", visitType: "visited" }],
    })
    assert.equal(all.totalFlights, 2)
    assert.ok(all.countries.some((c) => c.code === "TH"))
    assert.deepEqual(all.availableYears, [2025, 2024])

    const y2025 = buildPassportHistory({
      flights: [
        mkFlight("a", "2024-03-01", "JFK", "NRT"),
        mkFlight("b", "2025-05-01", "JFK", "CDG"),
      ],
      visitedCountries: [{ countryCode: "TH", countryName: "Thailand", visitType: "visited" }],
      year: 2025,
    })
    assert.equal(y2025.totalFlights, 1)
    // Visited countries always remain — year only filters flight-derived data.
    assert.ok(y2025.countries.some((c) => c.code === "TH"))
    assert.equal(y2025.routeSegments.length, 1)
    assert.deepEqual(y2025.availableYears, [2025, 2024])
  })

  it("returns zeroed values for empty / nullish input", () => {
    const r = buildPassportHistory({ flights: null, visitedCountries: null })
    assert.equal(r.totalFlights, 0)
    assert.equal(r.totalDistanceKm, 0)
    assert.deepEqual(r.uniqueAirports, [])
    assert.deepEqual(r.uniqueAirlines, [])
    assert.deepEqual(r.countries, [])
    assert.deepEqual(r.countryFlags, [])
    assert.deepEqual(r.recentFlights, [])
    assert.deepEqual(r.routeSegments, [])
    assert.deepEqual(r.availableYears, [])
  })
})

function mkFlight(
  id: string,
  date: string,
  dep: string | null,
  arr: string | null,
): {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
} {
  return {
    id,
    flightNumber: id.toUpperCase(),
    flightDate: date,
    airline: "Test Air",
    departureAirport: dep,
    arrivalAirport: arr,
    departureTime: null,
    arrivalTime: null,
  }
}
