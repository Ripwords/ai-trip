import { describe, it, expect } from "bun:test"

import { iataToCountry } from "../utils/iata-country-map"
import { AIRPORT_TIMEZONES, airportLocalTime } from "./airport-timezones"

describe("AIRPORT_TIMEZONES", () => {
  it("names a real IANA zone for every airport", () => {
    for (const [iata, zone] of Object.entries(AIRPORT_TIMEZONES)) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: zone }), iata).not.toThrow()
    }
  })

  it("covers every airport the app knows the country of", () => {
    const missing = Object.keys(iataToCountry).filter((iata) => !AIRPORT_TIMEZONES[iata])
    expect(missing).toEqual([])
  })
})

describe("airportLocalTime", () => {
  it("reads a wall-clock time in the airport's zone", () => {
    expect(airportLocalTime("2025-06-01T23:40", "SIN")?.toISOString()).toBe(
      "2025-06-01T15:40:00.000Z",
    )
    expect(airportLocalTime("2025-06-01 22:00:30", "LAX")?.toISOString()).toBe(
      "2025-06-02T05:00:30.000Z",
    )
  })

  it("is case-insensitive about the airport code", () => {
    expect(airportLocalTime("2025-06-01T23:40", "sin")?.toISOString()).toBe(
      "2025-06-01T15:40:00.000Z",
    )
  })

  it("reads a time that falls in a spring-forward gap as the instant after the jump", () => {
    // 02:30 on 2025-03-09 does not exist in New York; the clock read 03:30 EDT.
    expect(airportLocalTime("2025-03-09T02:30", "JFK")?.toISOString()).toBe(
      "2025-03-09T07:30:00.000Z",
    )
  })

  it("returns null for an unknown airport or an unparseable time", () => {
    expect(airportLocalTime("2025-06-01T10:00", "ZZZ")).toBeNull()
    expect(airportLocalTime("not a time", "SIN")).toBeNull()
    expect(airportLocalTime("", "SIN")).toBeNull()
  })
})
