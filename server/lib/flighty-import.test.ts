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
    expect(row.scheduledDepartureTime?.toISOString()).toBe(
      new Date("2022-10-01T15:30").toISOString(),
    )
    expect(row.actualDepartureTime?.toISOString()).toBe(new Date("2022-10-01T16:00").toISOString())
    expect(row.scheduledArrivalTime?.toISOString()).toBe(new Date("2022-10-01T20:25").toISOString())
    expect(row.actualArrivalTime?.toISOString()).toBe(new Date("2022-10-01T20:47").toISOString())
  })

  it("leaves the actual fields null rather than filling them from the scheduled ones", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2030-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2030-10-01T15:30,,,,,,2030-10-01T20:25,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    const row = result.rows[0]!
    expect(row.scheduledDepartureTime?.toISOString()).toBe(
      new Date("2030-10-01T15:30").toISOString(),
    )
    expect(row.scheduledArrivalTime?.toISOString()).toBe(new Date("2030-10-01T20:25").toISOString())
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
