import { and, eq, lt } from "drizzle-orm"
import { db } from "../../../db"
import { flights } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import {
  deriveFlightFields,
  lookupFlight,
  FLIGHT_LOOKUP_SCHEMA_VERSION,
} from "../../../lib/flight-api"

type FlightRow = typeof flights.$inferSelect

const REFETCH_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * If the row is stamped with an older lookup schema version, re-fetch once from
 * AeroDataBox under the current query semantics. Termination guarantees:
 *  - On a successful API response we always bump lookupSchemaVersion — so even if
 *    the new response is identical to what we already had, we never loop.
 *  - On API failure (no key / 404 / 429 / network error) we stamp apiLastFetchedAt
 *    and apply a 24h cooldown before the next attempt. This applies uniformly:
 *    a row that succeeded under the old version has its apiLastFetchedAt from the
 *    original fetch (typically far in the past), so the cooldown clears on first
 *    read and the migration is attempted; a row whose migration attempt fails has
 *    its apiLastFetchedAt reset to now, so we wait 24h before trying again.
 */
async function maybeMigrateRow(row: FlightRow): Promise<FlightRow> {
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

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id)

  const rows = await db.query.flights.findMany({
    where: eq(flights.tripId, id),
    orderBy: (f, { asc, sql }) => [asc(f.flightDate), sql`${f.departureTime} ASC NULLS LAST`],
  })

  // Opportunistically re-fetch any rows that pre-date the current lookup schema.
  // After everything is migrated this loop is a cheap version-check per row.
  // Sequentialized to avoid fan-out against AeroDataBox's rate limit on first read.
  const migrated: FlightRow[] = []
  for (const row of rows) {
    migrated.push(await maybeMigrateRow(row))
  }

  const result = []
  for (const row of migrated) {
    const { rawApiResponse, ...rest } = row
    result.push(Object.assign(rest, deriveFlightFields(rawApiResponse)))
  }
  return result
})
