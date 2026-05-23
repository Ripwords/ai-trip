import { eq } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { flights } from "../db/schema"
import { lookupFlight, FLIGHT_LOOKUP_SCHEMA_VERSION, type FlightLookupResult } from "./flight-api"
import { parseFlightyCsv, type ParsedFlightyRow } from "./flighty-import"
import { lookupIcaoToIata } from "./icao-to-iata-lookup"

// Applies an ICAO→IATA map (from Wikidata) to a parsed row. The map is built
// once per import — see callers below. Unknown / non-ICAO airline codes pass
// through unchanged. Storing the IATA form means manual entries (which use
// IATA) dedupe against Flighty imports (which use ICAO).
function applyIataMap(row: ParsedFlightyRow, icaoToIata: Map<string, string>): ParsedFlightyRow {
  const iata = icaoToIata.get(row.airline.toUpperCase())
  if (!iata || iata === row.airline) return row
  const flightNumber = row.flightNumber.startsWith(row.airline)
    ? iata + row.flightNumber.slice(row.airline.length)
    : row.flightNumber
  return { ...row, airline: iata, flightNumber }
}

function uniqueIcaoCodes(rows: ParsedFlightyRow[]): string[] {
  const out = new Set<string>()
  for (const row of rows) {
    if (/^[A-Z]{3}$/.test(row.airline)) out.add(row.airline)
  }
  return [...out]
}

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

// Visible for tests. Pure: builds the row to insert by merging the parsed CSV
// row with an optional lookup result. API fields win when non-null; CSV fills
// nulls and unenriched fields.
export function buildInsertRow(
  row: ParsedFlightyRow,
  looked: FlightLookupResult | null,
  userId: string,
) {
  if (looked) {
    return {
      userId,
      flightNumber: row.flightNumber,
      flightDate: row.flightDate,
      tripId: null as string | null,
      airline: looked.airline ?? row.airline,
      departureAirport: looked.departureAirport ?? row.departureAirport,
      arrivalAirport: looked.arrivalAirport ?? row.arrivalAirport,
      departureTime: looked.departureTime ?? row.departureTime,
      arrivalTime: looked.arrivalTime ?? row.arrivalTime,
      terminal: looked.terminal ?? row.terminal,
      gate: looked.gate ?? row.gate,
      status: looked.status ?? row.status,
      rawApiResponse: looked.rawApiResponse,
      apiLastFetchedAt: new Date(),
      lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
    }
  }
  return {
    userId,
    flightNumber: row.flightNumber,
    flightDate: row.flightDate,
    tripId: null as string | null,
    airline: row.airline,
    departureAirport: row.departureAirport,
    arrivalAirport: row.arrivalAirport,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    terminal: row.terminal,
    gate: row.gate,
    status: row.status,
    rawApiResponse: null as Record<string, unknown> | null,
    apiLastFetchedAt: null as Date | null,
    lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
  }
}

/**
 * Previews importable rows from a Flighty CSV without writing to the database.
 *
 * Parses the CSV, deduplicates against existing flights for `userId`, and
 * returns a summary with the first {@link PREVIEW_LIMIT} importable rows.
 * Throws `FlightyImportError` if the CSV is structurally invalid.
 */
export async function previewImport(
  csv: string,
  userId: string,
  db: DbHandle = defaultDb,
  now: Date = new Date(),
  icaoToIata?: Map<string, string>,
): Promise<PreviewResult> {
  const parsed = parseFlightyCsv(csv, now)
  const [existing, conversions] = await Promise.all([
    loadExistingPairs(db, userId),
    icaoToIata ? Promise.resolve(icaoToIata) : lookupIcaoToIata(uniqueIcaoCodes(parsed.rows)),
  ])

  let duplicateCount = 0
  const importable: ParsedFlightyRow[] = []
  for (const raw of parsed.rows) {
    const row = applyIataMap(raw, conversions)
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

/**
 * Commits importable rows from a Flighty CSV.
 *
 * The `now` parameter classifies past vs. future rows for the hybrid sourcing
 * rule: rows with `flightDate >= now.toISOString().slice(0,10)` attempt a
 * `lookupFlight` enrichment. Callers should generally pass `new Date()` (the
 * default). Note the UTC-date boundary: at hours surrounding midnight UTC,
 * a row may be classified differently than the user's local "today".
 */
export async function commitImport(
  csv: string,
  userId: string,
  db: DbHandle = defaultDb,
  now: Date = new Date(),
  icaoToIata?: Map<string, string>,
): Promise<CommitResult> {
  const parsed = parseFlightyCsv(csv, now)
  const [existing, conversions] = await Promise.all([
    loadExistingPairs(db, userId),
    icaoToIata ? Promise.resolve(icaoToIata) : lookupIcaoToIata(uniqueIcaoCodes(parsed.rows)),
  ])
  const todayIso = now.toISOString().slice(0, 10)
  const issues: { line: number; reason: string }[] = [...parsed.errors]

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const raw of parsed.rows) {
    const row = applyIataMap(raw, conversions)
    if (existing.has(pairKey(row))) {
      skipped++
      continue
    }
    const looked =
      row.flightDate >= todayIso ? await lookupFlight(row.flightNumber, row.flightDate) : null
    const insertRow = buildInsertRow(row, looked, userId)
    try {
      await db.insert(flights).values(insertRow).returning()
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
