import { eq } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { flights } from "../db/schema"
import { FLIGHT_LOOKUP_SCHEMA_VERSION, lookupFlight, type FlightLookupResult } from "./flight-api"

/**
 * Keeps a stored flight's status, gate and actual times current while they can
 * still change, and stops asking once they cannot.
 *
 * Refreshes happen on read (the flight lists call `refreshDueFlights`), so a
 * flight nobody looks at costs nothing. Per flight, the outbound API cost is
 * bounded by the window: at most one lookup per 2h from 48h before departure,
 * one per 15 min from 6h before departure until it lands, and one final lookup
 * after landing — roughly 50 over a flight's life, before the shared
 * `flight_api_cache` coalesces lookups across users.
 */

const HOUR_MS = 60 * 60 * 1000
const LEAD_MS = 48 * HOUR_MS
const TAIL_MS = 48 * HOUR_MS
const NEAR_MS = 6 * HOUR_MS
const NEAR_TTL_MS = 15 * 60 * 1000
const FAR_TTL_MS = 2 * HOUR_MS
/** How long after landing the airline's actual times take to settle. */
const SETTLE_MS = 30 * 60 * 1000
const DEFAULT_LIMIT = 3

export interface RefreshableFlight {
  id: string
  flightNumber: string
  flightDate: string
  status: string
  scheduledDepartureTime: Date | null
  actualDepartureTime: Date | null
  scheduledArrivalTime: Date | null
  actualArrivalTime: Date | null
  apiLastFetchedAt: Date | null
}

function departureMs(row: RefreshableFlight): number {
  return row.scheduledDepartureTime?.getTime() ?? new Date(row.flightDate + "T00:00:00Z").getTime()
}

/** Whether a stored flight's data is stale enough, and still changeable enough, to look up again. */
export function flightRefreshDue(row: RefreshableFlight, now: Date): boolean {
  const t = now.getTime()
  const dep = departureMs(row)
  const arr =
    row.actualArrivalTime?.getTime() ?? row.scheduledArrivalTime?.getTime() ?? dep + 24 * HOUR_MS

  if (t < dep - LEAD_MS || t > arr + TAIL_MS) return false

  const last = row.apiLastFetchedAt?.getTime()
  if (last === undefined) return true
  if (row.status === "cancelled") return false

  // Landed: one read after the actual times settle is the final record.
  if (t >= arr + SETTLE_MS) return last < arr + SETTLE_MS

  const ttl = t >= dep - NEAR_MS ? NEAR_TTL_MS : FAR_TTL_MS
  return t - last >= ttl
}

export interface RefreshDeps<T extends RefreshableFlight> {
  now?: Date
  /** Most lookups per call. Keeps a list request's latency and API spend bounded. */
  limit?: number
  lookup?: (flightNumber: string, flightDate: string) => Promise<FlightLookupResult | null>
  save?: (row: T, fresh: FlightLookupResult, fetchedAt: Date) => Promise<T>
}

/**
 * Look up the flights that are due (nearest departure first, at most `limit`)
 * and return `rows` with those replaced by their saved versions. A failed or
 * empty lookup leaves the stored row as it was; the list never fails on it.
 */
export async function refreshDueFlights<T extends RefreshableFlight>(
  rows: T[],
  deps: RefreshDeps<T> = {},
): Promise<T[]> {
  const now = deps.now ?? new Date()
  const lookup = deps.lookup ?? lookupFlight
  const save = deps.save ?? saveFlightLookup
  const limit = deps.limit ?? DEFAULT_LIMIT

  const due = rows
    .filter((row) => flightRefreshDue(row, now))
    .toSorted(
      (a, b) => Math.abs(departureMs(a) - now.getTime()) - Math.abs(departureMs(b) - now.getTime()),
    )
    .slice(0, limit)
  if (due.length === 0) return rows

  const refreshed = new Map<string, T>()
  await Promise.all(
    due.map(async (row) => {
      try {
        const fresh = await lookup(row.flightNumber, row.flightDate)
        if (fresh) refreshed.set(row.id, await save(row, fresh, now))
      } catch (err) {
        console.warn(`flight refresh failed for ${row.flightNumber} ${row.flightDate}:`, err)
      }
    }),
  )
  return rows.map((row) => refreshed.get(row.id) ?? row)
}

/** The columns a lookup owns on a stored flight. */
export function flightLookupColumns(fresh: FlightLookupResult, fetchedAt: Date) {
  return {
    airline: fresh.airline,
    departureAirport: fresh.departureAirport,
    arrivalAirport: fresh.arrivalAirport,
    scheduledDepartureTime: fresh.scheduledDepartureTime,
    actualDepartureTime: fresh.actualDepartureTime,
    scheduledArrivalTime: fresh.scheduledArrivalTime,
    actualArrivalTime: fresh.actualArrivalTime,
    terminal: fresh.terminal,
    gate: fresh.gate,
    status: fresh.status,
    rawApiResponse: fresh.rawApiResponse,
    apiLastFetchedAt: fetchedAt,
    lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
  }
}

/**
 * Default writer. Overlays the saved row (generated `departureTime` and
 * `arrivalTime` included) onto the caller's, keeping only the keys the caller
 * had, so a list that never selected `rawApiResponse` does not gain it.
 */
export async function saveFlightLookup<T extends RefreshableFlight>(
  row: T,
  fresh: FlightLookupResult,
  fetchedAt: Date,
  db: typeof defaultDb = defaultDb,
): Promise<T> {
  const [saved] = await db
    .update(flights)
    .set(flightLookupColumns(fresh, fetchedAt))
    .where(eq(flights.id, row.id))
    .returning()
  if (!saved) return row
  const overlaid: T = { ...row }
  for (const key of Object.keys(row)) {
    if (key in saved) Object.assign(overlaid, { [key]: saved[key as keyof typeof saved] })
  }
  return overlaid
}
