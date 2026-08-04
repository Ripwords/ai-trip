import { pgTable, uuid, text, numeric, timestamp, date, jsonb, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { activities } from "./activities"
import { user } from "./auth-schema"

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
    // Who paid for this expense
    paidById: text("paid_by_id").references(() => user.id, { onDelete: "set null" }),
    // Custom splits: { userId: amount } — who owes what portion
    // e.g., { "user1": "25.00", "user2": "25.00" } for a $50 expense split between 2
    splits: jsonb("splits").$type<Record<string, string>>(),
    // A calendar date, not an instant: "the day the money was spent" has no
    // time and no timezone. As timestamptz it was written as UTC midnight and
    // rendered in the viewer's local zone, so everyone west of UTC saw every
    // expense dated a day early.
    paidAt: date("paid_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_expenses_trip_id").on(table.tripId),
    index("idx_expenses_activity_id").on(table.activityId),
    index("idx_expenses_paid_by").on(table.paidById),
  ],
)

export const expensesRelations = relations(expenses, ({ one }) => ({
  trip: one(trips, { fields: [expenses.tripId], references: [trips.id] }),
  activity: one(activities, {
    fields: [expenses.activityId],
    references: [activities.id],
  }),
  paidBy: one(user, { fields: [expenses.paidById], references: [user.id] }),
}))
