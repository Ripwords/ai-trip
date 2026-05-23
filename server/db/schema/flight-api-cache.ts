import {
  pgTable,
  text,
  date,
  timestamp,
  jsonb,
  integer,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core"

// Cross-user shared cache for AeroDataBox lookups. Keyed on the same
// (flightNumber, flightDate) tuple lookupFlight() queries with, so a single
// API hit serves every user who later asks for the same flight.
//
// Why a dedicated table instead of reusing flights.rawApiResponse:
//   - flights rows are per-user. Two users importing the same flight today
//     would each trigger a fetch.
//   - Bulk Flighty imports can issue dozens of calls per request; with this
//     table, re-runs and concurrent users hit a row instead of the API.
//   - 404s have no flights row to attach to, so the negative cache lives here.
export const flightApiCache = pgTable(
  "flight_api_cache",
  {
    flightNumber: text("flight_number").notNull(),
    flightDate: date("flight_date").notNull(),
    response: jsonb("response").$type<Record<string, unknown> | null>(),
    notFound: boolean("not_found").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    lookupSchemaVersion: integer("lookup_schema_version").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.flightNumber, table.flightDate] })],
)
