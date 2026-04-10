import {
  pgTable,
  text,
  integer,
  numeric,
  uuid,
  jsonb,
  index,
  doublePrecision,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { itineraryDays } from "./itineraries"
import { travelSegments } from "./travel-segments"
import { expenses } from "./expenses"

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itineraryDayId: uuid("itinerary_day_id")
      .notNull()
      .references(() => itineraryDays.id, { onDelete: "cascade" }),

    // Google Maps data
    name: text("name").notNull(),
    placeId: text("place_id"),
    type: text("type").notNull().default("attraction"),
    description: text("description"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    address: text("address"),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    priceLevel: integer("price_level"),
    openingHours: jsonb("opening_hours").$type<string[]>().default([]),
    photos: jsonb("photos").$type<string[]>().default([]),

    // Planning data
    suggestedTime: text("suggested_time"),
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    costEstimate: numeric("cost_estimate", { precision: 10, scale: 2 }),
    tags: jsonb("tags").$type<string[]>().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    actualCost: numeric("actual_cost", { precision: 10, scale: 2 }),
  },
  (table) => [
    index("idx_activities_day_id").on(table.itineraryDayId),
    index("idx_activities_place_id").on(table.placeId),
  ],
)

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  day: one(itineraryDays, {
    fields: [activities.itineraryDayId],
    references: [itineraryDays.id],
  }),
  segmentsFrom: many(travelSegments, { relationName: "segmentFrom" }),
  segmentsTo: many(travelSegments, { relationName: "segmentTo" }),
  expenses: many(expenses),
}))
