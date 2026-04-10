import { pgTable, text, uuid, timestamp, jsonb, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { user } from "./auth-schema"

export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    // e.g., "activity_added", "activity_removed", "activity_modified",
    // "expense_added", "expense_removed", "ai_prompt", "member_invited",
    // "member_removed", "trip_updated", "day_accommodation_set"
    description: text("description").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_activity_log_trip_id").on(table.tripId),
    index("idx_activity_log_user_id").on(table.userId),
    index("idx_activity_log_created_at").on(table.createdAt),
  ],
)

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  trip: one(trips, { fields: [activityLog.tripId], references: [trips.id] }),
  user: one(user, { fields: [activityLog.userId], references: [user.id] }),
}))
