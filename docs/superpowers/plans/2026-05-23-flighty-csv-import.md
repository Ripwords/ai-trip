# Flighty CSV Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Flighty CSV importer to the global `/flights` page that populates the existing `flights` table — no schema changes, no extra fields. Past rows use CSV data as-is; future-dated rows attempt AeroDataBox lookup (current code path) and fall back to CSV.

**Architecture:** A pure CSV parser (`server/lib/flighty-import.ts`) feeds an injectable service layer (`server/lib/flight-import.ts`) that handles dedupe + per-row insert. Two thin Nitro endpoints expose it: `POST /api/flights/import/preview` (read-only summary) and `POST /api/flights/import` (commits inserts). UI is a single `ImportFlightyModal` opened from `app/pages/flights.vue`.

**Tech Stack:** Nuxt 3 (Vue 3 `<script setup>`), Nitro server routes, Drizzle ORM (Postgres), Bun test, Zod, Tailwind. Existing helpers: `requireAuth`, `lookupFlight`, `FLIGHT_LOOKUP_SCHEMA_VERSION`.

**Test runner:** `bun test <path>` (no npm script — invoke `bun test` directly).

---

## File Structure

### Create

- `server/lib/flighty-import.ts` — pure CSV → typed rows parser, no DB/HTTP.
- `server/lib/flighty-import.test.ts` — parser unit tests using the real fixture.
- `server/lib/flight-import.ts` — orchestration: dedupe lookup, hybrid sourcing, per-row insert. Takes `db` as a parameter for testability.
- `server/lib/flight-import.test.ts` — orchestration tests with fake `db`.
- `server/api/flights/import/preview.post.ts` — thin wrapper: auth → read body → call `previewImport`.
- `server/api/flights/import/index.post.ts` — thin wrapper: auth → read body → call `commitImport`.
- `app/components/ImportFlightyModal.vue` — picker / preview / result modal.

### Modify

- `app/pages/flights.vue` — add **Import from Flighty** button, mount the modal, refresh on import.

### Why this split

- **Parser is pure** — easy to test against the example fixture, no globals, no DB.
- **Orchestration is injectable** — matches the pattern in `server/lib/trip-flights.ts` (takes `db` as the second arg). Lets us write fake-db unit tests instead of standing up Postgres.
- **Endpoints are thin** — keep all logic in lib so endpoint tests aren't needed (no existing endpoint-test pattern in this repo).

---

## Task 1: Build the Flighty CSV parser (with tests)

**Files:**

- Create: `server/lib/flighty-import.ts`
- Test: `server/lib/flighty-import.test.ts`

The parser is deliberately self-contained: it does its own CSV tokenization (handles quoted fields), validates the Flighty header, and emits typed rows + per-line errors.

- [ ] **Step 1.1: Write the failing parser test file**

Create `server/lib/flighty-import.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseFlightyCsv, FlightyImportError } from "./flighty-import"

const FIXTURE_PATH = resolve(process.cwd(), "FlightyExport-2026-05-23.csv")

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
    // every row has the four required identity fields populated
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

  it("prefers actual times over scheduled when both present", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2022-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2022-10-01T15:30,2022-10-01T16:00,,,,,2022-10-01T20:25,2022-10-01T20:47,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.rows[0]!.departureTime?.toISOString()).toBe(
      new Date("2022-10-01T16:00").toISOString(),
    )
    expect(result.rows[0]!.arrivalTime?.toISOString()).toBe(
      new Date("2022-10-01T20:47").toISOString(),
    )
  })

  it("falls back to scheduled time when actual is empty", () => {
    const csv = [
      "Date,Airline,Flight,From,To,Dep Terminal,Dep Gate,Arr Terminal,Arr Gate,Canceled,Diverted To,Gate Departure (Scheduled),Gate Departure (Actual),Take off (Scheduled),Take off (Actual),Landing (Scheduled),Landing (Actual),Gate Arrival (Scheduled),Gate Arrival (Actual),Aircraft Type Name,Tail Number,PNR,Seat,Seat Type,Cabin Class,Flight Reason,Notes,Flight Flighty ID,Airline Flighty ID,Departure Airport Flighty ID,Arrival Airport Flighty ID,Diverted To Airport Flighty ID,Aircraft Type Flighty ID",
      "2030-10-01,EVA,228,KUL,TPE,1,C34,2,C3,false,,2030-10-01T15:30,,,,,,2030-10-01T20:25,,,,,,,,,,,,,,,",
    ].join("\n")
    const result = parseFlightyCsv(csv, new Date("2026-05-23"))
    expect(result.rows[0]!.departureTime?.toISOString()).toBe(
      new Date("2030-10-01T15:30").toISOString(),
    )
    expect(result.rows[0]!.arrivalTime?.toISOString()).toBe(
      new Date("2030-10-01T20:25").toISOString(),
    )
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
    // Notes is dropped, but parsing must not break on the embedded comma.
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.flightNumber).toBe("EVA228")
  })
})
```

- [ ] **Step 1.2: Run the test, confirm it fails for the right reason**

Run: `bun test server/lib/flighty-import.test.ts`
Expected: every test fails with a module-not-found error pointing at `./flighty-import`.

- [ ] **Step 1.3: Implement the parser**

Create `server/lib/flighty-import.ts`:

```ts
export class FlightyImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FlightyImportError"
  }
}

export interface ParsedFlightyRow {
  line: number // 1-indexed within the original CSV (header is line 1)
  flightNumber: string
  flightDate: string // YYYY-MM-DD
  airline: string
  departureAirport: string
  arrivalAirport: string
  departureTime: Date | null
  arrivalTime: Date | null
  terminal: string | null
  gate: string | null
  status: "scheduled" | "landed" | "cancelled"
}

export interface FlightyParseResult {
  rows: ParsedFlightyRow[]
  errors: { line: number; reason: string }[]
}

const REQUIRED_HEADERS = ["Date", "Airline", "Flight", "From", "To"] as const

// Minimal RFC 4180 line tokenizer: respects double-quoted fields with embedded commas
// and escaped double-quotes (""). Returns the field values in order.
function tokenizeCsvLine(line: string): string[] {
  const out: string[] = []
  let i = 0
  let cur = ""
  let inQuotes = false
  while (i < line.length) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ",") {
      out.push(cur)
      cur = ""
      i++
      continue
    }
    cur += ch
    i++
  }
  out.push(cur)
  return out
}

function splitCsvRows(input: string): string[] {
  // Normalize line endings; do NOT split on newlines that fall inside quoted fields.
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const rows: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      cur += ch
      continue
    }
    if (ch === "\n" && !inQuotes) {
      rows.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur.length > 0) rows.push(cur)
  return rows
}

function parseDateOrNull(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function parseFlightyCsv(input: string, today: Date): FlightyParseResult {
  const allLines = splitCsvRows(input)
  if (allLines.length === 0) {
    throw new FlightyImportError("This doesn't look like a Flighty export.")
  }
  const headerLine = allLines[0]!
  const headers = tokenizeCsvLine(headerLine).map((h) => h.trim())
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      throw new FlightyImportError("This doesn't look like a Flighty export.")
    }
  }
  const colIndex = (name: string) => headers.indexOf(name)
  const idx = {
    date: colIndex("Date"),
    airline: colIndex("Airline"),
    flight: colIndex("Flight"),
    from: colIndex("From"),
    to: colIndex("To"),
    depTerminal: colIndex("Dep Terminal"),
    depGate: colIndex("Dep Gate"),
    canceled: colIndex("Canceled"),
    gateDepScheduled: colIndex("Gate Departure (Scheduled)"),
    gateDepActual: colIndex("Gate Departure (Actual)"),
    gateArrScheduled: colIndex("Gate Arrival (Scheduled)"),
    gateArrActual: colIndex("Gate Arrival (Actual)"),
  }

  const todayIso = isoDate(today)
  const rows: ParsedFlightyRow[] = []
  const errors: { line: number; reason: string }[] = []

  for (let i = 1; i < allLines.length; i++) {
    const raw = allLines[i]!
    if (!raw.trim()) continue // blank line
    const lineNum = i + 1 // 1-indexed within the original CSV
    const cells = tokenizeCsvLine(raw).map((c) => c.trim())

    const date = cells[idx.date] ?? ""
    const airline = cells[idx.airline] ?? ""
    const flight = cells[idx.flight] ?? ""
    const from = cells[idx.from] ?? ""
    const to = cells[idx.to] ?? ""
    if (!date || !airline || !flight || !from || !to) {
      errors.push({
        line: lineNum,
        reason: "Missing required field (Date, Airline, Flight, From, or To)",
      })
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ line: lineNum, reason: `Invalid date: ${date}` })
      continue
    }

    const canceled = (cells[idx.canceled] ?? "").toLowerCase() === "true"
    const status: ParsedFlightyRow["status"] = canceled
      ? "cancelled"
      : date < todayIso
        ? "landed"
        : "scheduled"

    const depActual = idx.gateDepActual >= 0 ? cells[idx.gateDepActual] : ""
    const depScheduled = idx.gateDepScheduled >= 0 ? cells[idx.gateDepScheduled] : ""
    const arrActual = idx.gateArrActual >= 0 ? cells[idx.gateArrActual] : ""
    const arrScheduled = idx.gateArrScheduled >= 0 ? cells[idx.gateArrScheduled] : ""

    rows.push({
      line: lineNum,
      flightNumber: `${airline}${flight}`.toUpperCase().replace(/\s/g, ""),
      flightDate: date,
      airline,
      departureAirport: from.toUpperCase(),
      arrivalAirport: to.toUpperCase(),
      departureTime: parseDateOrNull(depActual || depScheduled || ""),
      arrivalTime: parseDateOrNull(arrActual || arrScheduled || ""),
      terminal: idx.depTerminal >= 0 ? cells[idx.depTerminal] || null : null,
      gate: idx.depGate >= 0 ? cells[idx.depGate] || null : null,
      status,
    })
  }

  return { rows, errors }
}
```

- [ ] **Step 1.4: Run the tests, confirm all pass**

Run: `bun test server/lib/flighty-import.test.ts`
Expected: all tests pass.

- [ ] **Step 1.5: Format + lint**

Run: `bun run fix` (this is `oxlint --fix && oxfmt --write .`)
Expected: no new errors. The pre-existing `no-map-spread` warning in `itinerary-review-ai.ts` is unrelated; leave it.

- [ ] **Step 1.6: Commit**

```bash
git add server/lib/flighty-import.ts server/lib/flighty-import.test.ts
git commit -m "feat(flights): add Flighty CSV parser"
```

---

## Task 2: Build the import orchestration library

**Files:**

- Create: `server/lib/flight-import.ts`
- Test: `server/lib/flight-import.test.ts`

This library accepts the raw CSV string plus a `userId`, parses it, looks up existing flights for that user to dedupe, and (for the commit path) inserts new rows. Hybrid sourcing: for future-dated rows it calls the existing `lookupFlight()`; for past rows it inserts CSV data as-is.

`db` is passed in (defaulting to the real one) so tests use a fake — matches the pattern in `server/lib/trip-flights.ts`.

- [ ] **Step 2.1: Write the failing orchestration test file**

Create `server/lib/flight-import.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { previewImport, commitImport } from "./flight-import"

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

describe("commitImport", () => {
  it("inserts importable past-dated rows and skips duplicates", async () => {
    const csv = makeCsv([
      "2022-10-01,EVA,228,KUL,TPE,1,C34,,,false,,,,,,,,2022-10-01T20:25,2022-10-01T20:47,,,,,,,,,,,,,,",
      "2022-10-02,EVA,227,TPE,KUL,1,B9,,,false,,,,,,,,2023-01-19T14:25,2023-01-19T15:06,,,,,,,,,,,,,,",
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
```

- [ ] **Step 2.2: Run the test, confirm it fails for the right reason**

Run: `bun test server/lib/flight-import.test.ts`
Expected: fails because `./flight-import` does not exist yet.

- [ ] **Step 2.3: Implement the orchestration**

Create `server/lib/flight-import.ts`:

```ts
import { eq } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { flights } from "../db/schema"
import { lookupFlight, FLIGHT_LOOKUP_SCHEMA_VERSION } from "./flight-api"
import { parseFlightyCsv, type ParsedFlightyRow } from "./flighty-import"

type DbHandle = typeof defaultDb

const PREVIEW_LIMIT = 20

export interface PreviewRow {
  line: number
  flightDate: string
  flightNumber: string
  departureAirport: string
  arrivalAirport: string
}

export interface PreviewResult {
  totalRows: number
  importableCount: number
  duplicateCount: number
  invalidCount: number
  preview: PreviewRow[]
  issues: { line: number; reason: string }[]
}

export interface CommitResult {
  imported: number
  skipped: number
  failed: number
  issues: { line: number; reason: string }[]
}

async function loadExistingPairs(db: DbHandle, userId: string): Promise<Set<string>> {
  const rows = await db.query.flights.findMany({
    where: eq(flights.userId, userId),
    columns: { flightNumber: true, flightDate: true },
  })
  return new Set(rows.map((r) => `${r.flightNumber}|${r.flightDate}`))
}

function pairKey(row: { flightNumber: string; flightDate: string }): string {
  return `${row.flightNumber}|${row.flightDate}`
}

export async function previewImport(
  csv: string,
  userId: string,
  db: DbHandle = defaultDb,
  now: Date = new Date(),
): Promise<PreviewResult> {
  const parsed = parseFlightyCsv(csv, now)
  const existing = await loadExistingPairs(db, userId)

  let duplicateCount = 0
  const importable: ParsedFlightyRow[] = []
  for (const row of parsed.rows) {
    if (existing.has(pairKey(row))) {
      duplicateCount++
      continue
    }
    importable.push(row)
  }
  importable.sort((a, b) => a.flightDate.localeCompare(b.flightDate))

  return {
    totalRows: parsed.rows.length + parsed.errors.length,
    importableCount: importable.length,
    duplicateCount,
    invalidCount: parsed.errors.length,
    preview: importable.slice(0, PREVIEW_LIMIT).map((r) => ({
      line: r.line,
      flightDate: r.flightDate,
      flightNumber: r.flightNumber,
      departureAirport: r.departureAirport,
      arrivalAirport: r.arrivalAirport,
    })),
    issues: parsed.errors,
  }
}

export async function commitImport(
  csv: string,
  userId: string,
  db: DbHandle = defaultDb,
  now: Date = new Date(),
): Promise<CommitResult> {
  const parsed = parseFlightyCsv(csv, now)
  const existing = await loadExistingPairs(db, userId)
  const todayIso = now.toISOString().slice(0, 10)
  const issues: { line: number; reason: string }[] = [...parsed.errors]

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const row of parsed.rows) {
    if (existing.has(pairKey(row))) {
      skipped++
      continue
    }

    let airline: string | null = row.airline || null
    let departureAirport: string | null = row.departureAirport || null
    let arrivalAirport: string | null = row.arrivalAirport || null
    let departureTime: Date | null = row.departureTime
    let arrivalTime: Date | null = row.arrivalTime
    let terminal: string | null = row.terminal
    let gate: string | null = row.gate
    let status: string = row.status
    let rawApiResponse: Record<string, unknown> | null = null
    let apiLastFetchedAt: Date | null = null

    if (row.flightDate >= todayIso) {
      const looked = await lookupFlight(row.flightNumber, row.flightDate)
      if (looked) {
        airline = looked.airline ?? airline
        departureAirport = looked.departureAirport ?? departureAirport
        arrivalAirport = looked.arrivalAirport ?? arrivalAirport
        departureTime = looked.departureTime ?? departureTime
        arrivalTime = looked.arrivalTime ?? arrivalTime
        terminal = looked.terminal ?? terminal
        gate = looked.gate ?? gate
        status = looked.status ?? status
        rawApiResponse = looked.rawApiResponse
        apiLastFetchedAt = new Date()
      }
    }

    try {
      await db
        .insert(flights)
        .values({
          userId,
          flightNumber: row.flightNumber,
          flightDate: row.flightDate,
          tripId: null,
          airline,
          departureAirport,
          arrivalAirport,
          departureTime,
          arrivalTime,
          terminal,
          gate,
          status,
          rawApiResponse,
          apiLastFetchedAt,
          lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
        })
        .returning()
      imported++
      existing.add(pairKey(row))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (/unique|duplicate/i.test(message)) {
        skipped++
      } else {
        failed++
        issues.push({ line: row.line, reason: message })
      }
    }
  }

  return { imported, skipped, failed, issues }
}
```

- [ ] **Step 2.4: Run the tests, confirm all pass**

Run: `bun test server/lib/flight-import.test.ts`
Expected: all four tests pass.

- [ ] **Step 2.5: Run the full lib test suite to catch regressions**

Run: `bun test server/lib`
Expected: no test failures in any pre-existing file. (If an unrelated test is flaky, note it but don't fix it in this task.)

- [ ] **Step 2.6: Format + lint, then commit**

```bash
bun run fix
git add server/lib/flight-import.ts server/lib/flight-import.test.ts
git commit -m "feat(flights): add Flighty import preview + commit service"
```

---

## Task 3: Add the preview endpoint

**Files:**

- Create: `server/api/flights/import/preview.post.ts`

Thin wrapper. The endpoint accepts `text/csv` as the raw request body (not multipart — simpler, since CSVs are plain text and the codebase has no multipart pattern yet). The browser sends the `File` object directly as the body.

- [ ] **Step 3.1: Create the endpoint**

Create `server/api/flights/import/preview.post.ts`:

```ts
import { previewImport } from "../../../lib/flight-import"

const MAX_CSV_BYTES = 2 * 1024 * 1024 // 2 MB

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const raw = await readRawBody(event, "utf-8")
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: "Empty CSV body" })
  }
  if (Buffer.byteLength(raw, "utf-8") > MAX_CSV_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "CSV too large (max 2 MB)" })
  }
  try {
    return await previewImport(raw, session.user.id)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "FlightyImportError") {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
```

- [ ] **Step 3.2: Format + lint**

Run: `bun run fix`
Expected: clean.

- [ ] **Step 3.3: Commit**

```bash
git add server/api/flights/import/preview.post.ts
git commit -m "feat(flights): add POST /api/flights/import/preview endpoint"
```

---

## Task 4: Add the commit endpoint

**Files:**

- Create: `server/api/flights/import/index.post.ts`

Same shape as preview, calling `commitImport` instead.

- [ ] **Step 4.1: Create the endpoint**

Create `server/api/flights/import/index.post.ts`:

```ts
import { commitImport } from "../../../lib/flight-import"

const MAX_CSV_BYTES = 2 * 1024 * 1024 // 2 MB

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const raw = await readRawBody(event, "utf-8")
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: "Empty CSV body" })
  }
  if (Buffer.byteLength(raw, "utf-8") > MAX_CSV_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "CSV too large (max 2 MB)" })
  }
  try {
    return await commitImport(raw, session.user.id)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "FlightyImportError") {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
})
```

- [ ] **Step 4.2: Format + lint**

Run: `bun run fix`
Expected: clean.

- [ ] **Step 4.3: Commit**

```bash
git add server/api/flights/import/index.post.ts
git commit -m "feat(flights): add POST /api/flights/import endpoint"
```

---

## Task 5: Add the import modal

**Files:**

- Create: `app/components/ImportFlightyModal.vue`

A self-contained modal modeled on `AddActivityModal.vue` (teleport to body, overlay closes on backdrop click, content uses `bg-stone-50` per the dark-mode-safe convention in `feedback_bg_white_dark_override.md`).

Three internal phases: `picker` → `previewing` → `result`. Emits `close` and `imported` events.

- [ ] **Step 5.1: Create the component**

Create `app/components/ImportFlightyModal.vue`:

```vue
<script setup lang="ts">
interface PreviewRow {
  line: number
  flightDate: string
  flightNumber: string
  departureAirport: string
  arrivalAirport: string
}

interface PreviewResponse {
  totalRows: number
  importableCount: number
  duplicateCount: number
  invalidCount: number
  preview: PreviewRow[]
  issues: { line: number; reason: string }[]
}

interface CommitResponse {
  imported: number
  skipped: number
  failed: number
  issues: { line: number; reason: string }[]
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: "close"): void
  (e: "imported"): void
}>()

type Phase = "picker" | "previewing" | "result"
const phase = ref<Phase>("picker")
const error = ref<string | null>(null)
const busy = ref(false)
const fileRef = ref<File | null>(null)
const preview = ref<PreviewResponse | null>(null)
const result = ref<CommitResponse | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function reset() {
  phase.value = "picker"
  error.value = null
  busy.value = false
  fileRef.value = null
  preview.value = null
  result.value = null
  if (fileInput.value) fileInput.value.value = ""
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  },
)

async function onPick(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  if (!file) return
  fileRef.value = file
  busy.value = true
  error.value = null
  try {
    const text = await file.text()
    preview.value = await $fetch<PreviewResponse>("/api/flights/import/preview", {
      method: "POST",
      body: text,
      headers: { "Content-Type": "text/csv" },
    })
    phase.value = "previewing"
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to read CSV"
    error.value = msg.replace(/^.*?:\s*/, "") || "Failed to read CSV"
  } finally {
    busy.value = false
  }
}

async function confirmImport() {
  if (!fileRef.value) return
  busy.value = true
  error.value = null
  try {
    const text = await fileRef.value.text()
    result.value = await $fetch<CommitResponse>("/api/flights/import", {
      method: "POST",
      body: text,
      headers: { "Content-Type": "text/csv" },
    })
    phase.value = "result"
    if (result.value.imported > 0) emit("imported")
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Import failed"
    error.value = msg.replace(/^.*?:\s*/, "") || "Import failed"
  } finally {
    busy.value = false
  }
}

function close() {
  emit("close")
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/40" @click="close" />
      <div class="relative z-10 mx-4 w-full max-w-lg rounded-2xl bg-stone-50 p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-lg text-sand-900">Import from Flighty</h2>
          <button class="text-sand-400 hover:text-sand-700" @click="close">
            <Icon name="lucide:x" class="h-5 w-5" />
          </button>
        </div>

        <!-- Picker phase -->
        <div v-if="phase === 'picker'" class="mt-4 space-y-3">
          <p class="text-sm text-sand-600">
            Upload your Flighty CSV export. We'll show you a preview before importing.
          </p>
          <label
            class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-sand-300 p-6 text-center hover:bg-sand-50"
          >
            <Icon name="lucide:upload" class="h-6 w-6 text-sand-400" />
            <span class="text-sm text-sand-600">
              {{ fileRef ? fileRef.name : "Choose a .csv file" }}
            </span>
            <input
              ref="fileInput"
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              :disabled="busy"
              @change="onPick"
            />
          </label>
          <p v-if="busy" class="text-xs text-sand-500">Reading file…</p>
          <p v-if="error" class="text-xs text-red-600">{{ error }}</p>
        </div>

        <!-- Previewing phase -->
        <div v-else-if="phase === 'previewing' && preview" class="mt-4 space-y-4">
          <div class="grid grid-cols-3 gap-3 text-center">
            <div class="rounded-xl border border-sand-200 p-3">
              <div class="text-2xl font-display text-sand-900">{{ preview.importableCount }}</div>
              <div class="text-xs text-sand-500">New</div>
            </div>
            <div class="rounded-xl border border-sand-200 p-3">
              <div class="text-2xl font-display text-sand-500">{{ preview.duplicateCount }}</div>
              <div class="text-xs text-sand-500">Duplicate</div>
            </div>
            <div class="rounded-xl border border-sand-200 p-3">
              <div class="text-2xl font-display text-sand-500">{{ preview.invalidCount }}</div>
              <div class="text-xs text-sand-500">Invalid</div>
            </div>
          </div>

          <div
            v-if="preview.preview.length > 0"
            class="max-h-60 overflow-y-auto rounded-xl border border-sand-200"
          >
            <table class="w-full text-left text-xs">
              <thead class="bg-sand-100 text-sand-600">
                <tr>
                  <th class="px-3 py-2 font-medium">Date</th>
                  <th class="px-3 py-2 font-medium">Flight</th>
                  <th class="px-3 py-2 font-medium">Route</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in preview.preview" :key="row.line" class="border-t border-sand-100">
                  <td class="px-3 py-2 text-sand-700">{{ row.flightDate }}</td>
                  <td class="px-3 py-2 text-sand-900">{{ row.flightNumber }}</td>
                  <td class="px-3 py-2 text-sand-600">
                    {{ row.departureAirport }} → {{ row.arrivalAirport }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="preview.importableCount > preview.preview.length"
              class="px-3 py-2 text-xs text-sand-500"
            >
              + {{ preview.importableCount - preview.preview.length }} more
            </div>
          </div>

          <details
            v-if="preview.issues.length > 0"
            class="rounded-xl border border-sand-200 p-3 text-xs"
          >
            <summary class="cursor-pointer text-sand-600">
              {{ preview.issues.length }} issue(s) — these rows will be skipped
            </summary>
            <ul class="mt-2 space-y-1 text-sand-600">
              <li v-for="issue in preview.issues" :key="issue.line">
                Line {{ issue.line }}: {{ issue.reason }}
              </li>
            </ul>
          </details>

          <p v-if="error" class="text-xs text-red-600">{{ error }}</p>

          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-xl border border-sand-200 px-4 py-2 text-sm text-sand-700 hover:bg-sand-50"
              :disabled="busy"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-xl bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
              :disabled="busy || preview.importableCount === 0"
              @click="confirmImport"
            >
              {{ busy ? "Importing…" : `Import ${preview.importableCount} flight(s)` }}
            </button>
          </div>
        </div>

        <!-- Result phase -->
        <div v-else-if="phase === 'result' && result" class="mt-4 space-y-4">
          <p class="text-sm text-sand-700">
            Imported <strong>{{ result.imported }}</strong> · Skipped
            <strong>{{ result.skipped }}</strong> · Failed
            <strong>{{ result.failed }}</strong>
          </p>
          <details
            v-if="result.issues.length > 0"
            class="rounded-xl border border-sand-200 p-3 text-xs"
          >
            <summary class="cursor-pointer text-sand-600">
              {{ result.issues.length }} issue(s)
            </summary>
            <ul class="mt-2 space-y-1 text-sand-600">
              <li v-for="issue in result.issues" :key="`${issue.line}-${issue.reason}`">
                Line {{ issue.line }}: {{ issue.reason }}
              </li>
            </ul>
          </details>
          <div class="flex justify-end">
            <button
              type="button"
              class="rounded-xl bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600"
              @click="close"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 5.2: Format + lint**

Run: `bun run fix`
Expected: clean.

- [ ] **Step 5.3: Commit**

```bash
git add app/components/ImportFlightyModal.vue
git commit -m "feat(flights): add ImportFlightyModal component"
```

---

## Task 6: Wire the modal into the flights page

**Files:**

- Modify: `app/pages/flights.vue` — add the Import button and modal mount.

- [ ] **Step 6.1: Add the import button + modal mount**

In `app/pages/flights.vue`, add the modal state in the `<script setup>` block (after the existing `const showPast = ref(false)` line, around line 101):

```ts
const showImportModal = ref(false)
function openImportModal() {
  showImportModal.value = true
}
async function onImported() {
  await refresh()
}
```

Then in the `<template>`, locate the existing add-flight form `<form>` block (around lines 126–154). Immediately **after** the closing `</form>` tag, insert a small button row:

```vue
<div class="flex justify-end">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-xl border border-sand-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-sand-700 transition hover:bg-sand-100"
        @click="openImportModal"
      >
        <Icon name="lucide:upload" class="h-3.5 w-3.5" />
        Import from Flighty
      </button>
    </div>
```

Then at the very end of the template, immediately **before** the closing `</div>` of the page's outer wrapper, mount the modal:

```vue
<ImportFlightyModal
  :open="showImportModal"
  @close="showImportModal = false"
  @imported="onImported"
/>
```

- [ ] **Step 6.2: Format + lint**

Run: `bun run fix`
Expected: clean.

- [ ] **Step 6.3: Commit**

```bash
git add app/pages/flights.vue
git commit -m "feat(flights): wire Flighty import button on /flights"
```

---

## Task 7: Smoke test the full flow in the running app

This is a manual verification — the user explicitly cares that the example CSV imports cleanly.

- [ ] **Step 7.1: Start the dev server**

Run: `bun run dev`
Expected: Nuxt boots on port 3000 (or whichever port the project uses; check terminal output).

- [ ] **Step 7.2: Verify the happy path**

In a browser:

1. Log in.
2. Visit `/flights`.
3. Click **Import from Flighty**.
4. Pick `FlightyExport-2026-05-23.csv` from the project root.
5. Confirm the preview shows non-zero `New` count and zero `Invalid`.
6. Click **Import N flight(s)**.
7. Confirm the result modal shows `Imported N` with N matching what was new.
8. Close the modal. The flights list should now show the past flights in the **Past Flights** section.

- [ ] **Step 7.3: Verify dedupe**

Re-import the same CSV:

1. Click **Import from Flighty** again, pick the same file.
2. Preview should show `0 New, N Duplicate, 0 Invalid`.
3. The **Import** button should be disabled (no importable rows).

- [ ] **Step 7.4: Verify non-Flighty CSV is rejected**

Create a quick fake CSV in the picker (use any unrelated CSV file on hand, e.g., from `~/Downloads`) — uploading should surface "This doesn't look like a Flighty export." in the modal without crashing.

- [ ] **Step 7.5: Stop the dev server and confirm working tree is clean**

Run: `git status`
Expected: clean (all changes committed in previous tasks).

---

## Spec coverage check

| Spec requirement                                                                       | Covered by                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Parse Flighty CSV, validate header, surface per-row errors                             | Task 1                                                                                     |
| Field mapping table (flightNumber = Airline+Flight, dep/arr times, status derivation)  | Task 1                                                                                     |
| Hybrid sourcing: CSV for past, `lookupFlight` for future with CSV fallback             | Task 2                                                                                     |
| Dedupe by `(userId, flightNumber, flightDate)`, skip silently                          | Task 2                                                                                     |
| `POST /api/flights/import/preview` returns counts + first ~20 importable rows          | Task 2 + Task 3                                                                            |
| `POST /api/flights/import` inserts and returns `{ imported, skipped, failed, issues }` | Task 2 + Task 4                                                                            |
| Modal flow: picker → preview → confirm → result                                        | Task 5                                                                                     |
| Import button on `/flights`, refresh list on success                                   | Task 6                                                                                     |
| No schema changes — only existing `flights` columns populated                          | Task 2 (verified by inspecting the `db.insert(flights).values({...})` shape — no new keys) |
| `tripId` stays null on import                                                          | Task 2 (`tripId: null` in the insert)                                                      |
| Trip assignment remains via existing FlightCard UI                                     | No code change needed                                                                      |
| Error handling: missing/invalid file, non-Flighty CSV, unauth, oversize                | Tasks 3, 4, 5                                                                              |
| Test fixtures use the real `FlightyExport-2026-05-23.csv`                              | Task 1                                                                                     |
| Manual smoke test on the running app                                                   | Task 7                                                                                     |
