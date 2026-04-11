import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
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
    departureTime: timestamp("departure_time", { withTimezone: true }),
    arrivalTime: timestamp("arrival_time", { withTimezone: true }),
    terminal: text("terminal"),
    gate: text("gate"),
    status: text("status").notNull().default("scheduled"),
    rawApiResponse: jsonb("raw_api_response"),
    apiLastFetchedAt: timestamp("api_last_fetched_at", { withTimezone: true }),
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
