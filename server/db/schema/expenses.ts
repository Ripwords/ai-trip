import {
  pgTable, uuid, text, numeric, timestamp, index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { trips } from "./trips";
import { activities } from "./activities";

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    category: text("category").notNull().default("other"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_expenses_trip_id").on(table.tripId),
    index("idx_expenses_activity_id").on(table.activityId),
  ]
);

export const expensesRelations = relations(expenses, ({ one }) => ({
  trip: one(trips, { fields: [expenses.tripId], references: [trips.id] }),
  activity: one(activities, {
    fields: [expenses.activityId],
    references: [activities.id],
  }),
}));
