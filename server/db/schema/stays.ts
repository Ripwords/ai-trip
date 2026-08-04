import { pgTable, uuid, text, date, timestamp, index, doublePrecision } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { itineraryDays } from "./itineraries"

/**
 * An accommodation booking-worth-of-nights: one contiguous run of days at the
 * same place. Accommodation used to exist only as identical copies of the
 * hotel name/place id on every `itinerary_days` row it covered, which left
 * nothing for a reservation to reference and no check-in/check-out at all.
 *
 * `itinerary_days.accommodation_*` survives as a derived read-cache — see
 * `server/lib/stays.ts#syncDayAccommodation`, its only writer.
 */
export const stays = pgTable(
  "stays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    placeId: text("place_id"),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // Calendar dates, not instants — a check-in has no timezone.
    checkIn: date("check_in").notNull(),
    // Exclusive: the morning after the last night.
    checkOut: date("check_out").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("idx_stays_trip_id").on(table.tripId)],
)

export const staysRelations = relations(stays, ({ one, many }) => ({
  trip: one(trips, { fields: [stays.tripId], references: [trips.id] }),
  days: many(itineraryDays),
}))
