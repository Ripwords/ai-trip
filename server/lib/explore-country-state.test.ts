import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildEffectiveVisitedCountries } from "./explore-country-state"

describe("effective explore country state", () => {
  it("promotes completed trip countries to visited without manual rows", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [],
      trips: [
        {
          id: "trip-jp",
          countryCode: "JP",
          destination: "Japan",
          startDate: "2026-05-01",
          endDate: "2026-05-05",
          status: "upcoming",
          exploreSuppressedAt: null,
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(result.find((row) => row.countryCode === "JP")?.visitType, "visited")
  })

  it("keeps cancelled trips as want to visit until they are suppressed", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [],
      trips: [
        {
          id: "trip-th",
          countryCode: "TH",
          destination: "Thailand",
          startDate: "2026-07-01",
          endDate: "2026-07-05",
          status: "cancelled",
          exploreSuppressedAt: null,
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(result.find((row) => row.countryCode === "TH")?.visitType, "want_to_visit")
  })

  it("ignores suppressed cancelled trips unless the country was otherwise visited", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [],
      trips: [
        {
          id: "trip-th",
          countryCode: "TH",
          destination: "Thailand",
          startDate: "2026-07-01",
          endDate: "2026-07-05",
          status: "cancelled",
          exploreSuppressedAt: new Date("2026-06-04T12:00:00Z"),
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(
      result.find((row) => row.countryCode === "TH"),
      undefined,
    )
  })

  it("ignores suppressed completed trips unless the country was otherwise visited", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [],
      trips: [
        {
          id: "trip-jp",
          countryCode: "JP",
          destination: "Japan",
          startDate: "2026-05-01",
          endDate: "2026-05-05",
          status: "upcoming",
          exploreSuppressedAt: new Date("2026-06-04T12:00:00Z"),
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(
      result.find((row) => row.countryCode === "JP"),
      undefined,
    )
  })

  it("lets a prior completed trip beat a later cancelled trip suppression", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [],
      trips: [
        {
          id: "trip-th-old",
          countryCode: "TH",
          destination: "Thailand",
          startDate: "2026-01-01",
          endDate: "2026-01-05",
          status: "upcoming",
          exploreSuppressedAt: null,
        },
        {
          id: "trip-th-cancelled",
          countryCode: "TH",
          destination: "Thailand",
          startDate: "2026-07-01",
          endDate: "2026-07-05",
          status: "cancelled",
          exploreSuppressedAt: new Date("2026-06-04T12:00:00Z"),
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(result.find((row) => row.countryCode === "TH")?.visitType, "visited")
  })

  it("lets manual non-visited state override a suppressed completed trip", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [
        {
          countryCode: "JP",
          countryName: "Japan",
          visitType: "want_to_visit",
          visitedAt: null,
          createdAt: new Date("2026-06-04T00:00:00Z"),
        },
      ],
      trips: [
        {
          id: "trip-jp",
          countryCode: "JP",
          destination: "Japan",
          startDate: "2026-05-01",
          endDate: "2026-05-05",
          status: "upcoming",
          exploreSuppressedAt: new Date("2026-06-04T12:00:00Z"),
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(result.find((row) => row.countryCode === "JP")?.visitType, "want_to_visit")
  })

  it("preserves manual visited over trip-derived states", () => {
    const result = buildEffectiveVisitedCountries({
      manualRows: [
        {
          countryCode: "TH",
          countryName: "Thailand",
          visitType: "visited",
          visitedAt: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      trips: [
        {
          id: "trip-th",
          countryCode: "TH",
          destination: "Thailand",
          startDate: "2026-07-01",
          endDate: "2026-07-05",
          status: "cancelled",
          exploreSuppressedAt: new Date("2026-06-04T12:00:00Z"),
        },
      ],
      today: new Date("2026-06-04T12:00:00Z"),
    })

    assert.equal(result.find((row) => row.countryCode === "TH")?.visitType, "visited")
  })
})
