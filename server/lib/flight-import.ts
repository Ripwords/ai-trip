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
