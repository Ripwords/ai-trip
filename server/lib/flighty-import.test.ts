import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseFlightyCsv, FlightyImportError } from "./flighty-import"

const FIXTURE_PATH = resolve(import.meta.dir, "__fixtures__/flighty-sample.csv")

describe("parseFlightyCsv", () => {
  it("rejects a CSV whose header is not Flighty's", () => {
    expect(() => parseFlightyCsv("foo,bar\n1,2", new Date("2026-05-23"))).toThrow(
      FlightyImportError,
    )
  })

  it("parses every data row in the example fixture", () => {
    const csv = readFileSync(FIXTURE_PATH, "utf8")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.errors).toEqual([])
    expect(result.rows.length).toBeGreaterThan(0)
    for (const row of result.rows) {
      expect(row.flightNumber).toMatch(/^[A-Z0-9]+$/)
      expect(row.flightDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.departureAirport).toMatch(/^[A-Z]{3}$/)
      expect(row.arrivalAirport).toMatch(/^[A-Z]{3}$/)
    }
  })

  it("derives flightNumber as Airline + Flight", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2022-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2022-10-01T15:30,2022-10-01T16:00,,,,,2022-10-01T20:25,2022-10-01T20:47,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.rows[0]!.flightNumber).toBe("EVA228")
  })

  it("keeps scheduled and actual times in separate fields when both are present", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2022-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2022-10-01T15:30,2022-10-01T16:00,,,,,2022-10-01T20:25,2022-10-01T20:47,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    const row = result.rows[0]!
    expect(row.scheduledDepartureTime?.toISOString()).toBe("2022-10-01T07:30:00.000Z")
    expect(row.actualDepartureTime?.toISOString()).toBe("2022-10-01T08:00:00.000Z")
    expect(row.scheduledArrivalTime?.toISOString()).toBe("2022-10-01T12:25:00.000Z")
    expect(row.actualArrivalTime?.toISOString()).toBe("2022-10-01T12:47:00.000Z")
  })

  it("leaves the actual fields null rather than filling them from the scheduled ones", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2030-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2030-10-01T15:30,,,,,,2030-10-01T20:25,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    const row = result.rows[0]!
    expect(row.scheduledDepartureTime?.toISOString()).toBe("2030-10-01T07:30:00.000Z")
    expect(row.scheduledArrivalTime?.toISOString()).toBe("2030-10-01T12:25:00.000Z")
    expect(row.actualDepartureTime).toBeNull()
    expect(row.actualArrivalTime).toBeNull()
  })

  it("a delay on the onward leg leaves the booked CDG layover at its booked length", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2022-10-01,AF,011,JFK,CDG,,,2E,K42,false,,2022-10-01T01:00,2022-10-01T01:05,,,,,2022-10-01T08:00,2022-10-01T08:00,,,,,,,,,,,,,,",
      "2022-10-01,AF,198,CDG,KUL,2E,K50,,,false,,2022-10-01T14:00,2022-10-01T16:13,,,,,2022-10-01T23:30,2022-10-02T01:40,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    const inbound = result.rows[0]!
    const outbound = result.rows[1]!
    const gapMinutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000

    expect(gapMinutes(inbound.scheduledArrivalTime!, outbound.scheduledDepartureTime!)).toBe(360)
    expect(gapMinutes(inbound.actualArrivalTime!, outbound.actualDepartureTime!)).toBe(493)
  })

  describe("times are each airport's local wall clock", () => {
    const header =
      "Date,Airline,Flight,From,To,Canceled,Gate Departure (Scheduled),Gate Departure (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual)"
    const minutes = (from: Date | null, to: Date | null) =>
      (to!.getTime() - from!.getTime()) / 60_000

    it("reads departure in the origin's zone and arrival in the destination's", () => {
      const csv = [
        header,
        // SQ322 SIN 23:40 (+08) → LHR 06:05 (+01, BST): 13h25 at the gate.
        "2025-06-01,SQ,322,SIN,LHR,false,2025-06-01T23:35,2025-06-01T23:40,2025-06-02T06:10,2025-06-02T06:05",
        // AA100 LAX 22:00 (-07, PDT) → JFK 06:30 (-04, EDT): 5h30.
        "2025-06-01,AA,100,LAX,JFK,false,2025-06-01T22:00,2025-06-01T22:00,2025-06-02T06:30,2025-06-02T06:30",
      ].join("\n")
      const [sq, aa] = parseFlightyCsv(csv, new Date("2026-10-12T00:00:00Z")).rows

      expect(sq!.actualDepartureTime?.toISOString()).toBe("2025-06-01T15:40:00.000Z")
      expect(sq!.actualArrivalTime?.toISOString()).toBe("2025-06-02T05:05:00.000Z")
      expect(minutes(sq!.actualDepartureTime, sq!.actualArrivalTime)).toBe(13 * 60 + 25)
      expect(minutes(aa!.scheduledDepartureTime, aa!.scheduledArrivalTime)).toBe(5 * 60 + 30)
    })

    it("follows the destination's daylight-saving offset on the day", () => {
      // LHR is +00:00 in January.
      const csv = [header, "2025-01-15,SQ,322,SIN,LHR,false,,,2025-01-16T05:10,"].join("\n")
      const [row] = parseFlightyCsv(csv, new Date("2026-10-12T00:00:00Z")).rows
      expect(row!.scheduledArrivalTime?.toISOString()).toBe("2025-01-16T05:10:00.000Z")
    })

    it("honours a time that already carries its own offset", () => {
      const csv = [header, "2025-06-01,SQ,322,SIN,LHR,false,2025-06-01T23:35+08:00,,,"].join("\n")
      const [row] = parseFlightyCsv(csv, new Date("2026-10-12T00:00:00Z")).rows
      expect(row!.scheduledDepartureTime?.toISOString()).toBe("2025-06-01T15:35:00.000Z")
    })

    it("leaves a time unknown rather than guessing when the airport's zone is unknown", () => {
      const csv = [
        header,
        "2025-06-01,XX,1,ZZZ,SIN,false,2025-06-01T10:00,,2025-06-01T14:00,",
      ].join("\n")
      const [row] = parseFlightyCsv(csv, new Date("2026-10-12T00:00:00Z")).rows
      expect(row!.scheduledDepartureTime).toBeNull()
      expect(row!.scheduledArrivalTime?.toISOString()).toBe("2025-06-01T06:00:00.000Z")
    })
  })

  it("derives status: past flights are landed, future are scheduled, canceled wins", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2022-10-01,EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
      "2030-10-01,EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
      "2030-10-02,EVA,229,TPE,KUL,,,,,true,,,,,,,,,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.rows.map((r) => r.status)).toEqual(["landed", "scheduled", "cancelled"])
  })

  it("records an error for rows missing required identity fields", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      ",EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.line).toBe(2)
  })

  it("skips blank lines silently", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "",
      "2022-10-01,EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
      "",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.rows).toHaveLength(1)
    expect(result.errors).toEqual([])
  })

  it("handles quoted fields containing commas", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      `2022-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2022-10-01T15:30,2022-10-01T16:00,,,,,,,,,,,,,,"hello, world",,,,,,`,
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.flightNumber).toBe("EVA228")
  })

  it("treats a bare double-quote inside an unquoted field as a literal character", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      `2022-10-01,EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,5" legroom note,,,,,,`,
      "2022-10-02,EVA,229,TPE,KUL,,,,,false,,,,,,,,,,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]!.flightNumber).toBe("EVA228")
    expect(result.rows[1]!.flightNumber).toBe("EVA229")
  })

  it("classifies today's flights as scheduled, not landed", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2026-05-23,EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23T00:00:00Z"))
    expect(result.rows[0]!.status).toBe("scheduled")
  })
})
