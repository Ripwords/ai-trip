import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildPreTripBriefing, getTripJourneyKind, getPreTripCandidate } from "./dashboard-briefing"

const today = new Date("2026-06-01T12:00:00Z")

function trip(overrides: Partial<Parameters<typeof getPreTripCandidate>[0][number]> = {}) {
  return {
    id: "trip-1",
    destination: "Tokyo",
    startDate: "2026-06-07",
    endDate: "2026-06-12",
    days: [
      {
        accommodationName: "Hotel The Celestine Tokyo",
      },
    ],
    ...overrides,
  }
}

describe("dashboard briefing", () => {
  it("selects the nearest trip only inside the 7 day pre-trip window", () => {
    assert.equal(getPreTripCandidate([trip({ startDate: "2026-06-09" })], today), null)
    assert.equal(getPreTripCandidate([trip({ startDate: "2026-06-08" })], today)?.id, "trip-1")
    assert.equal(getPreTripCandidate([trip({ startDate: "2026-05-31" })], today), null)
  })

  it("uses an earlier linked flight as the travel start date", () => {
    const trips = [trip({ startDate: "2026-06-09", endDate: "2026-06-14" })]
    const flights = [
      {
        id: "flight-early",
        tripId: "trip-1",
        flightNumber: "TR469",
        flightDate: "2026-06-08",
        departureAirport: "KUL",
        arrivalAirport: "SIN",
        departureTime: "2026-06-08T11:15:00.000Z",
        arrivalTime: "2026-06-08T12:20:00.000Z",
        terminal: "2",
        gate: null,
        status: "scheduled",
      },
    ]

    assert.equal(getPreTripCandidate(trips, today, flights)?.id, "trip-1")

    const briefing = buildPreTripBriefing({
      trip: trips[0],
      today,
      flights,
      passports: [{ countryCode: "MY", expiryDate: "2031-01-01", isDefault: true }],
      visaByCountry: {
        SG: { visaStatus: "visa-free", maxStayDays: 30 },
      },
    })

    assert.ok(briefing)
    assert.equal(briefing.daysUntil, 7)
    assert.equal(briefing.departureDate, "2026-06-08")
    assert.equal(briefing.startDate, "2026-06-09")
  })

  it("includes layover visa checks but caps the side rail at three signals", () => {
    const briefing = buildPreTripBriefing({
      trip: trip(),
      today,
      flights: [
        {
          id: "flight-1",
          tripId: "trip-1",
          flightNumber: "TR808",
          flightDate: "2026-06-07",
          departureAirport: "SIN",
          arrivalAirport: "TPE",
          departureTime: "2026-06-07T00:20:00.000Z",
          arrivalTime: "2026-06-07T05:10:00.000Z",
          terminal: "1",
          gate: null,
          status: "scheduled",
        },
        {
          id: "flight-2",
          tripId: "trip-1",
          flightNumber: "BR184",
          flightDate: "2026-06-07",
          departureAirport: "TPE",
          arrivalAirport: "NRT",
          departureTime: "2026-06-07T08:20:00.000Z",
          arrivalTime: "2026-06-07T11:40:00.000Z",
          terminal: null,
          gate: null,
          status: "scheduled",
        },
      ],
      passports: [{ countryCode: "MY", expiryDate: "2031-01-01", isDefault: true }],
      visaByCountry: {
        JP: { visaStatus: "visa-free", maxStayDays: 90 },
        TW: { visaStatus: "unknown", maxStayDays: null },
      },
    })

    assert.ok(briefing)
    assert.equal(briefing.daysUntil, 6)
    assert.ok(briefing.signals.length <= 3)
    assert.ok(briefing.signals.some((signal) => /layover/i.test(signal.title)))
    assert.ok(briefing.chips.some((chip) => /TPE/.test(chip.label)))
  })

  it("does not label the final destination or return route as a layover", () => {
    const briefing = buildPreTripBriefing({
      trip: trip(),
      today,
      flights: [
        {
          id: "outbound-1",
          tripId: "trip-1",
          flightNumber: "TR469",
          flightDate: "2026-06-07",
          departureAirport: "KUL",
          arrivalAirport: "SIN",
          departureTime: "2026-06-07T11:15:00.000Z",
          arrivalTime: "2026-06-07T12:20:00.000Z",
          terminal: "2",
          gate: null,
          status: "scheduled",
        },
        {
          id: "outbound-2",
          tripId: "trip-1",
          flightNumber: "TR808",
          flightDate: "2026-06-07",
          departureAirport: "SIN",
          arrivalAirport: "NRT",
          departureTime: "2026-06-07T14:20:00.000Z",
          arrivalTime: "2026-06-07T20:40:00.000Z",
          terminal: null,
          gate: null,
          status: "scheduled",
        },
        {
          id: "return-1",
          tripId: "trip-1",
          flightNumber: "TR809",
          flightDate: "2026-06-12",
          departureAirport: "NRT",
          arrivalAirport: "SIN",
          departureTime: "2026-06-12T11:00:00.000Z",
          arrivalTime: "2026-06-12T17:20:00.000Z",
          terminal: null,
          gate: null,
          status: "scheduled",
        },
        {
          id: "return-2",
          tripId: "trip-1",
          flightNumber: "TR468",
          flightDate: "2026-06-12",
          departureAirport: "SIN",
          arrivalAirport: "KUL",
          departureTime: "2026-06-12T19:10:00.000Z",
          arrivalTime: "2026-06-12T20:15:00.000Z",
          terminal: null,
          gate: null,
          status: "scheduled",
        },
      ],
      passports: [{ countryCode: "MY", expiryDate: "2031-01-01", isDefault: true }],
      visaByCountry: {
        JP: { visaStatus: "visa-free", maxStayDays: 90 },
        MY: { visaStatus: "visa-free", maxStayDays: null },
        SG: { visaStatus: "unknown", maxStayDays: null },
      },
    })

    assert.ok(briefing)
    const layoverChip = briefing.chips.find((chip) => chip.label.startsWith("Layover:"))
    assert.equal(layoverChip?.label, "Layover: SG")
    assert.ok(!layoverChip?.label.includes("JP"))
    assert.ok(!layoverChip?.label.includes("MY"))
  })

  it("uses only the final linked flight to detect a homebound trip", () => {
    const flights = [
      {
        id: "outbound",
        tripId: "trip-1",
        flightNumber: "TR808",
        flightDate: "2026-06-07",
        departureAirport: "KUL",
        arrivalAirport: "NRT",
        departureTime: "2026-06-07T14:20:00.000Z",
        arrivalTime: "2026-06-07T20:40:00.000Z",
        terminal: null,
        gate: null,
        status: "scheduled",
      },
      {
        id: "return-connection",
        tripId: "trip-1",
        flightNumber: "TR809",
        flightDate: "2026-06-12",
        departureAirport: "NRT",
        arrivalAirport: "SIN",
        departureTime: "2026-06-12T11:00:00.000Z",
        arrivalTime: "2026-06-12T17:20:00.000Z",
        terminal: null,
        gate: null,
        status: "scheduled",
      },
      {
        id: "return-final",
        tripId: "trip-1",
        flightNumber: "TR468",
        flightDate: "2026-06-12",
        departureAirport: "SIN",
        arrivalAirport: "KUL",
        departureTime: "2026-06-12T19:10:00.000Z",
        arrivalTime: "2026-06-12T20:15:00.000Z",
        terminal: null,
        gate: null,
        status: "scheduled",
      },
    ]

    assert.equal(getTripJourneyKind(flights, { countryCode: "MY" }, "MY"), "homebound")
    assert.equal(getTripJourneyKind(flights, { countryCode: "MY" }, "JP"), "outbound")
    assert.equal(getTripJourneyKind(flights, { countryCode: "SG" }, "MY"), "outbound")
  })
})
