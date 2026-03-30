import {
  pgTable, uuid, text, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { activities } from "./activities";
import { user } from "./auth-schema";

export const activityParticipants = pgTable(
  "activity_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_activity_participants_unique").on(table.activityId, table.userId),
    index("idx_activity_participants_activity_id").on(table.activityId),
  ]
);

export const activityParticipantsRelations = relations(activityParticipants, ({ one }) => ({
  activity: one(activities, { fields: [activityParticipants.activityId], references: [activities.id] }),
  user: one(user, { fields: [activityParticipants.userId], references: [user.id] }),
}));
