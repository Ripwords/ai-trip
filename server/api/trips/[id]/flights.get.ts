import { and, eq, lt } from "drizzle-orm"
import { db } from "../../../db"
import { flights, trips, tripMembers } from "../../../db/schema"
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
 *  - On API failure (no key / 404 / network error) we only stamp apiLastFetchedAt
 *    and apply a 24h cooldown for rows that never had a successful lookup. Rows
 *    that previously succeeded are retried on every read until they succeed once
 *    under the new version (and then bump out of the migration cohort).
 */
async function maybeMigrateRow(row: FlightRow): Promise<FlightRow> {
  if (row.lookupSchemaVersion >= FLIGHT_LOOKUP_SCHEMA_VERSION) return row

  const hasPriorSuccess = row.rawApiResponse !== null
  if (!hasPriorSuccess && row.apiLastFetchedAt) {
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
        and(
          eq(flights.id, row.id),
          lt(flights.lookupSchemaVersion, FLIGHT_LOOKUP_SCHEMA_VERSION),
        ),
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

  // Verify trip access (owner or member)
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  if (trip.userId !== session.user.id) {
    const membership = await db.query.tripMembers.findFirst({
      where: and(eq(tripMembers.tripId, id), eq(tripMembers.userId, session.user.id)),
    })
    if (!membership) {
      throw createError({ statusCode: 403, message: "Not authorized" })
    }
  }

  const rows = await db.query.flights.findMany({
    where: eq(flights.tripId, id),
    orderBy: (f, { asc, sql }) => [asc(f.flightDate), sql`${f.departureTime} ASC NULLS LAST`],
  })

  // Opportunistically re-fetch any rows that pre-date the current lookup schema.
  // After everything is migrated this loop is a cheap version-check on each row.
  const migrated = await Promise.all(rows.map(maybeMigrateRow))

  const result = []
  for (const row of migrated) {
    const { rawApiResponse, ...rest } = row
    result.push(Object.assign(rest, deriveFlightFields(rawApiResponse)))
  }
  return result
})
