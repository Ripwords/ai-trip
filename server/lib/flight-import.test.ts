import { describe, it, expect } from "bun:test"
import { previewImport, commitImport, buildInsertRow } from "./flight-import"
import { FlightyImportError } from "./flighty-import"

const HEADER =
  "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID"

function makeCsv(lines: string[]): string {
  return [HEADER, ...lines].join("\n")
}

interface FakeRow {
  flightNumber: string
  flightDate: string
}

function makeFakeDb(existing: FakeRow[] = []) {
  const inserted: Record<string, unknown>[] = []
  const db = {
    query: {
      flights: {
        findMany: async (_opts: unknown) =>
          existing.map((r) => ({ flightNumber: r.flightNumber, flightDate: r.flightDate })),
      },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push(row)
          return [row]
        },
      }),
    }),
  }
  return { db, inserted }
}

describe("previewImport", () => {
  it("counts importable, duplicate, and invalid rows", async () => {
    const csv = makeCsv([
      "2022-10-01,EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
      "2022-10-02,EVA,227,TPE,KUL,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
      ",EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
    ])
    const { db } = makeFakeDb([{ flightNumber: "EVA228", flightDate: "2022-10-01" }])
    const result = await previewImport(csv, "user-1", db as never, new Date("2026-05-23"))
    expect(result.totalRows).toBe(3)
    expect(result.importableCount).toBe(1)
    expect(result.duplicateCount).toBe(1)
    expect(result.invalidCount).toBe(1)
    expect(result.preview).toHaveLength(1)
    expect(result.preview[0]!.flightNumber).toBe("EVA227")
    expect(result.issues).toHaveLength(1)
  })
})

describe("previewImport empty input", () => {
  it("propagates FlightyImportError on empty CSV", async () => {
    const { db } = makeFakeDb()
    await expect(previewImport("", "user-1", db as never, new Date("2026-05-23"))).rejects.toThrow(
      FlightyImportError,
    )
  })
})

describe("commitImport", () => {
  it("inserts importable past-dated rows and skips duplicates", async () => {
    const csv = makeCsv([
      "2022-10-01,EVA,228,KUL,TPE,1,C34,,,false,,,,,,,,2022-10-01T20:25,2022-10-01T20:47,,,,,,,,,,,,,,",
      "2022-10-02,EVA,227,TPE,KUL,1,B9,,,false,,,,,,,,2022-10-02T14:25,2022-10-02T15:06,,,,,,,,,,,,,,",
    ])
    const { db, inserted } = makeFakeDb([{ flightNumber: "EVA228", flightDate: "2022-10-01" }])
    const result = await commitImport(csv, "user-1", db as never, new Date("2026-05-23"))
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.flightNumber).toBe("EVA227")
    expect(inserted[0]!.userId).toBe("user-1")
    expect(inserted[0]!.status).toBe("landed")
    expect(inserted[0]!.terminal).toBe("1")
    expect(inserted[0]!.gate).toBe("B9")
  })

  it("records parse errors as issues without affecting counts of valid rows", async () => {
    const csv = makeCsv([
      ",EVA,228,KUL,TPE,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
      "2022-10-02,EVA,227,TPE,KUL,,,,,false,,,,,,,,,,,,,,,,,,,,,,,",
    ])
    const { db, inserted } = makeFakeDb()
    const result = await commitImport(csv, "user-1", db as never, new Date("2026-05-23"))
    expect(result.imported).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.issues).toHaveLength(1)
    expect(inserted).toHaveLength(1)
  })

  it("uses CSV data for future-dated rows when lookup returns null", async () => {
    // AERODATABOX_API_KEY is unset in the test env -> lookupFlight returns null
    const csv = makeCsv([
      "2030-10-01,EVA,228,KUL,TPE,1,C34,,,false,,2030-10-01T15:30,,,,,,2030-10-01T20:25,,,,,,,,,,,,,,,,",
    ])
    const { db, inserted } = makeFakeDb()
    const result = await commitImport(csv, "user-1", db as never, new Date("2026-05-23"))
    expect(result.imported).toBe(1)
    expect(inserted[0]!.status).toBe("scheduled")
    expect(inserted[0]!.departureAirport).toBe("KUL")
    expect(inserted[0]!.terminal).toBe("1")
  })
})

describe("buildInsertRow", () => {
  const csvRow = {
    line: 2,
    flightNumber: "EVA228",
    flightDate: "2030-10-01",
    airline: "EVA",
    departureAirport: "KUL",
    arrivalAirport: "TPE",
    departureTime: new Date("2030-10-01T15:30"),
    arrivalTime: new Date("2030-10-01T20:25"),
    terminal: "1",
    gate: "C34",
    status: "scheduled" as const,
  }

  it("uses CSV values when no lookup result is provided", () => {
    const out = buildInsertRow(csvRow, null, "user-1")
    expect(out.airline).toBe("EVA")
    expect(out.terminal).toBe("1")
    expect(out.status).toBe("scheduled")
    expect(out.rawApiResponse).toBeNull()
    expect(out.apiLastFetchedAt).toBeNull()
  })

  it("prefers lookup result over CSV when both are present", () => {
    const looked = {
      airline: "EVA Air",
      departureAirport: "KUL",
      arrivalAirport: "TPE",
      departureTime: new Date("2030-10-01T15:45"),
      arrivalTime: new Date("2030-10-01T20:30"),
      terminal: "1M",
      gate: "C36",
      status: "scheduled",
      rawApiResponse: { foo: "bar" } as Record<string, unknown>,
    }
    const out = buildInsertRow(csvRow, looked, "user-1")
    expect(out.airline).toBe("EVA Air")
    expect(out.terminal).toBe("1M")
    expect(out.gate).toBe("C36")
    expect(out.departureTime).toEqual(looked.departureTime)
    expect(out.rawApiResponse).toEqual({ foo: "bar" })
    expect(out.apiLastFetchedAt).toBeInstanceOf(Date)
  })

  it("falls back to CSV values for individual fields the lookup left null", () => {
    const looked = {
      airline: null,
      departureAirport: null,
      arrivalAirport: null,
      departureTime: null,
      arrivalTime: null,
      terminal: null,
      gate: null,
      status: "scheduled",
      rawApiResponse: {} as Record<string, unknown>,
    }
    const out = buildInsertRow(csvRow, looked, "user-1")
    expect(out.airline).toBe("EVA")
    expect(out.terminal).toBe("1")
    expect(out.gate).toBe("C34")
    expect(out.departureTime).toEqual(csvRow.departureTime)
    expect(out.status).toBe("scheduled")
  })
})
