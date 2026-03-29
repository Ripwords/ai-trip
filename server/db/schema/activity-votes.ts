import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { activities } from "./activities";
import { user } from "./auth-schema";

export const activityVotes = pgTable(
  "activity_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    vote: text("vote").notNull(), // "up" or "down"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_activity_votes_unique").on(table.activityId, table.userId),
  ]
);

export const activityVotesRelations = relations(activityVotes, ({ one }) => ({
  activity: one(activities, { fields: [activityVotes.activityId], references: [activities.id] }),
  user: one(user, { fields: [activityVotes.userId], references: [user.id] }),
}));
