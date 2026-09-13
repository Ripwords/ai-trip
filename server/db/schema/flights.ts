import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  jsonb,
  uniqueIndex,
  index,
  integer,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { user } from "./auth-schema"
import { trips } from "./trips"

export const flights = pgTable(
  "flights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    flightNumber: text("flight_number").notNull(),
    flightDate: date("flight_date").notNull(),
    airline: text("airline"),
    departureAirport: text("departure_airport"),
    arrivalAirport: text("arrival_airport"),
    scheduledDepartureTime: timestamp("scheduled_departure_time", { withTimezone: true }),
    actualDepartureTime: timestamp("actual_departure_time", { withTimezone: true }),
    scheduledArrivalTime: timestamp("scheduled_arrival_time", { withTimezone: true }),
    actualArrivalTime: timestamp("actual_arrival_time", { withTimezone: true }),
    // Generated rather than dropped: readers that predate the scheduled/actual split
    // (ordering, the trip page, the AI prompts) still get one instant per end, while
    // every writer is forced to say which clock it is reporting.
    departureTime: timestamp("departure_time", { withTimezone: true }).generatedAlwaysAs(
      sql`coalesce(actual_departure_time, scheduled_departure_time)`,
    ),
    arrivalTime: timestamp("arrival_time", { withTimezone: true }).generatedAlwaysAs(
      sql`coalesce(actual_arrival_time, scheduled_arrival_time)`,
    ),
    terminal: text("terminal"),
    gate: text("gate"),
    status: text("status").notNull().default("scheduled"),
    rawApiResponse: jsonb("raw_api_response"),
    apiLastFetchedAt: timestamp("api_last_fetched_at", { withTimezone: true }),
    // Bumped whenever lookupFlight()'s query semantics change in a way that may yield
    // a different response for the same (flightNumber, flightDate). Rows older than the
    // current version are opportunistically re-fetched on next read.
    lookupSchemaVersion: integer("lookup_schema_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_flights_user_flight_date").on(
      table.userId,
      table.flightNumber,
      table.flightDate,
    ),
    index("idx_flights_user_id").on(table.userId),
    index("idx_flights_trip_id").on(table.tripId),
  ],
)

export const flightsRelations = relations(flights, ({ one }) => ({
  user: one(user, { fields: [flights.userId], references: [user.id] }),
  trip: one(trips, { fields: [flights.tripId], references: [trips.id] }),
}))
