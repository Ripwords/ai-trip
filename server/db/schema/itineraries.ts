import {
  pgTable,
  text,
  integer,
  date,
  uuid,
  index,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core"
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
    /**
     * When this day last changed — the day row itself OR any of its activities,
     * including deletions.
     *
     * Maintained by database triggers (migration 0043), NOT by application
     * code. Neither this table nor `activities` had any timestamp before, and
     * the alternative — bumping a column from every write path — is right until
     * someone adds the eleventh path and forgets. It also cannot see a DELETE,
     * and "an activity was removed" is exactly a change this must detect.
     *
     * Read as an opaque version token, not as "when the user was last here":
     * its job is the ordering comparison that decides whether an AI proposal
     * has been superseded by a later edit, from any trip member.
     */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
