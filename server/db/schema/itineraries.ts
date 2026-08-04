import { pgTable, text, integer, date, uuid, index, doublePrecision } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { activities } from "./activities"
import { travelSegments } from "./travel-segments"
import { stays } from "./stays"

export const itineraryDays = pgTable(
  "itinerary_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    date: date("date").notNull(),
    notes: text("notes"),
    // The canonical accommodation entity. The `accommodation_*` columns below
    // are a derived read-cache kept in sync from this stay — eight reader
    // modules still read them, so they stay until those are migrated.
    stayId: uuid("stay_id").references(() => stays.id, { onDelete: "set null" }),
    accommodationName: text("accommodation_name"),
    accommodationPlaceId: text("accommodation_place_id"),
    accommodationAddress: text("accommodation_address"),
    accommodationLat: doublePrecision("accommodation_lat"),
    accommodationLng: doublePrecision("accommodation_lng"),
  },
  (table) => [
    index("idx_itinerary_days_trip_id").on(table.tripId),
    index("idx_itinerary_days_stay_id").on(table.stayId),
  ],
)

export const itineraryDaysRelations = relations(itineraryDays, ({ one, many }) => ({
  trip: one(trips, { fields: [itineraryDays.tripId], references: [trips.id] }),
  stay: one(stays, { fields: [itineraryDays.stayId], references: [stays.id] }),
  activities: many(activities),
  travelSegments: many(travelSegments),
}))
