import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { activities } from "./activities"
import { user } from "./auth-schema"

export const activityComments = pgTable(
  "activity_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_activity_comments_activity_id").on(table.activityId)],
)

export const activityCommentsRelations = relations(activityComments, ({ one }) => ({
  activity: one(activities, { fields: [activityComments.activityId], references: [activities.id] }),
  user: one(user, { fields: [activityComments.userId], references: [user.id] }),
}))
