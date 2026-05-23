import { and, eq, lt } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { flights } from "../db/schema"
import { deriveFlightFields, lookupFlight, FLIGHT_LOOKUP_SCHEMA_VERSION } from "./flight-api"

type FlightRow = typeof flights.$inferSelect
type DbHandle = typeof defaultDb

const REFETCH_COOLDOWN_MS = 24 * 60 * 60 * 1000

async function maybeMigrateRow(db: DbHandle, row: FlightRow): Promise<FlightRow> {
  if (row.lookupSchemaVersion >= FLIGHT_LOOKUP_SCHEMA_VERSION) return row

  if (row.apiLastFetchedAt) {
    const sinceLast = Date.now() - new Date(row.apiLastFetchedAt).getTime()
    if (sinceLast < REFETCH_COOLDOWN_MS) return row
  }

  const result = await lookupFlight(row.flightNumber, row.flightDate)
  const now = new Date()

  if (result) {
    await db
      .update(flights)
      .set({
        airline: result.airline,
        departureAirport: result.departureAirport,
        arrivalAirport: result.arrivalAirport,
        departureTime: result.departureTime,
        arrivalTime: result.arrivalTime,
        terminal: result.terminal,
        gate: result.gate,
        status: result.status,
        rawApiResponse: result.rawApiResponse,
        apiLastFetchedAt: now,
        lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
      })
      .where(
        and(eq(flights.id, row.id), lt(flights.lookupSchemaVersion, FLIGHT_LOOKUP_SCHEMA_VERSION)),
      )
  } else {
    await db.update(flights).set({ apiLastFetchedAt: now }).where(eq(flights.id, row.id))
  }

  const fresh = await db.query.flights.findFirst({ where: eq(flights.id, row.id) })
  return fresh ?? row
}

/**
 * Return the flights linked to `tripId` that belong to `userId`. Flights are
 * user-scoped: a member of a shared trip only sees their own linked flights,
 * never another member's.
 *
 * `dbOverride` is for testing; production callers omit it and use the default
 * Drizzle handle.
 */
export async function getTripFlightsForUser(
  args: { tripId: string; userId: string },
  dbOverride?: DbHandle,
) {
  const db = dbOverride ?? defaultDb
  const rows = await db.query.flights.findMany({
    where: and(eq(flights.tripId, args.tripId), eq(flights.userId, args.userId)),
    orderBy: (f, { asc, sql }) => [asc(f.flightDate), sql`${f.departureTime} ASC NULLS LAST`],
  })

  const migrated: FlightRow[] = []
  for (const row of rows) {
    migrated.push(await maybeMigrateRow(db, row))
  }

  return migrated.map((row) => {
    const { rawApiResponse, ...rest } = row
    return Object.assign(rest, deriveFlightFields(rawApiResponse))
  })
}
