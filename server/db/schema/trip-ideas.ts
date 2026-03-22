import {
  pgTable, uuid, text, integer, numeric, doublePrecision,
  jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { trips } from "./trips";

export const tripIdeas = pgTable(
  "trip_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    placeId: text("place_id"),
    type: text("type").notNull().default("attraction"),
    description: text("description"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    address: text("address"),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    priceLevel: integer("price_level"),
    photos: jsonb("photos").$type<string[]>().default([]),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_trip_ideas_trip_id").on(table.tripId),
  ]
);

export const tripIdeasRelations = relations(tripIdeas, ({ one }) => ({
  trip: one(trips, { fields: [tripIdeas.tripId], references: [trips.id] }),
}));
