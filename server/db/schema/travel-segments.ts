import { pgTable, uuid, integer, text, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { activities } from "./activities"
import { itineraryDays } from "./itineraries"

export const travelSegments = pgTable(
  "travel_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itineraryDayId: uuid("itinerary_day_id")
      .notNull()
      .references(() => itineraryDays.id, { onDelete: "cascade" }),
    fromActivityId: uuid("from_activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    toActivityId: uuid("to_activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: integer("distance_meters"),
    durationText: text("duration_text"),
    distanceText: text("distance_text"),
    mode: text("mode").notNull().default("driving"),
  },
  (table) => [
    index("idx_travel_segments_day_id").on(table.itineraryDayId),
    index("idx_travel_segments_from").on(table.fromActivityId),
  ],
)

export const travelSegmentsRelations = relations(travelSegments, ({ one }) => ({
  day: one(itineraryDays, {
    fields: [travelSegments.itineraryDayId],
    references: [itineraryDays.id],
  }),
  fromActivity: one(activities, {
    fields: [travelSegments.fromActivityId],
    references: [activities.id],
    relationName: "segmentFrom",
  }),
  toActivity: one(activities, {
    fields: [travelSegments.toActivityId],
    references: [activities.id],
    relationName: "segmentTo",
  }),
}))
