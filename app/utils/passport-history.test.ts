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

  it("includes only visitType=visited entries — drops layover, want_to_visit, and flight-derived", () => {
    const result = buildPassportHistory({
      flights: [
        {
          id: "f1",
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
        { countryCode: "IT", countryName: "Italy", visitType: "want_to_visit" },
        { countryCode: "ES", countryName: "Spain", visitType: "visited" },
      ],
    })

    // Alphabetical by country name: Japan, Spain.
    assert.deepEqual(
      result.countries.map((c) => c.code),
      ["JP", "ES"],
    )

    // Layover/want-to-visit/flight-derived must NOT appear.
    assert.equal(
      result.countries.find((c) => c.code === "TH"),
      undefined,
    )
    assert.equal(
      result.countries.find((c) => c.code === "IT"),
      undefined,
    )
    assert.equal(
      result.countries.find((c) => c.code === "FR"),
      undefined,
    )
    assert.equal(
      result.countries.find((c) => c.code === "GB"),
      undefined,
    )

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

  it("excludes future flights from totals so it mirrors Flighty Passport", () => {
    const result = buildPassportHistory({
      flights: [
        mkFlight("past", "2025-01-01", "JFK", "NRT"),
        mkFlight("future", "2027-01-01", "JFK", "LHR"),
      ],
      visitedCountries: [],
      now: new Date("2026-05-24T00:00:00Z"),
    })

    assert.equal(result.totalFlights, 1)
    assert.deepEqual(result.uniqueAirports.toSorted(), ["JFK", "NRT"])
    assert.equal(result.routeSegments.length, 1)
    assert.equal(result.recentFlights.length, 1)
    assert.equal(result.recentFlights[0]?.id, "past")
  })

  it("excludes cancelled flights from totals so it mirrors Flighty Passport", () => {
    const result = buildPassportHistory({
      flights: [
        mkFlight("ok", "2025-01-01", "JFK", "NRT"),
        { ...mkFlight("cxl", "2025-06-01", "JFK", "LHR"), status: "cancelled" },
      ],
      visitedCountries: [],
      now: new Date("2026-05-24T00:00:00Z"),
    })

    assert.equal(result.totalFlights, 1)
    assert.equal(result.routeSegments.length, 1)
    assert.equal(result.recentFlights[0]?.id, "ok")
  })

  it("omits future-only years from availableYears since scoping there would be empty", () => {
    const result = buildPassportHistory({
      flights: [
        mkFlight("past", "2025-01-01", "JFK", "NRT"),
        mkFlight("future", "2027-01-01", "JFK", "LHR"),
      ],
      visitedCountries: [],
      now: new Date("2026-05-24T00:00:00Z"),
    })

    assert.deepEqual(result.availableYears, [2025])
  })

  it("keeps a year in availableYears if any flight in it has happened", () => {
    const result = buildPassportHistory({
      flights: [
        mkFlight("past-2026", "2026-01-15", "JFK", "NRT"),
        mkFlight("future-2026", "2026-11-01", "JFK", "LHR"),
      ],
      visitedCountries: [],
      now: new Date("2026-05-24T00:00:00Z"),
    })

    assert.deepEqual(result.availableYears, [2026])
  })

  it("excludes future flights even when the user scopes to a year", () => {
    // Year scoping never bypasses the "must have happened" rule — flights in
    // the future of the selected year are still dropped from totals.
    const result = buildPassportHistory({
      flights: [
        mkFlight("past-2026", "2026-01-01", "JFK", "NRT"),
        mkFlight("future-2026", "2026-12-01", "JFK", "LHR"),
        { ...mkFlight("cxl", "2026-02-01", "JFK", "CDG"), status: "cancelled" },
      ],
      visitedCountries: [],
      year: 2026,
      now: new Date("2026-05-24T00:00:00Z"),
    })

    assert.equal(result.totalFlights, 1)
    assert.equal(result.recentFlights[0]?.id, "past-2026")
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
