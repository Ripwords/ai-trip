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
    // WHAT WAS ACTUALLY PAID, in `currencyCode`. Immutable: nothing may ever
    // rewrite this. Changing the trip currency used to multiply this column in
    // place, so a ¥3,200 lunch became "20.64" with no record that it was ever
    // yen and no record of the rate used.
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    // The currency the payment was made in — a Japan/Korea trip has two, and a
    // card-issuer rate differs from the mid-market one.
    currencyCode: text("currency_code").notNull().default("USD"),
    // Rate from `currencyCode` to the trip's currency at the time of entry.
    // Recorded so a report can be explained rather than merely asserted.
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
    // DERIVED reporting projection: amount * fxRate, rounded to the trip
    // currency's precision. Changing the trip currency re-projects this column
    // and leaves `amount` alone.
    amountInTripCurrency: numeric("amount_in_trip_currency", { precision: 12, scale: 2 }),
    category: text("category").notNull().default("other"),
    // Who paid for this expense
    paidById: text("paid_by_id").references(() => user.id, { onDelete: "set null" }),
    // How `splits` below was derived, so the edit form can round-trip the
    // user's intent rather than only its resolved output.
    // One of shared/utils/splits.ts SPLIT_MODES: equal | exact | shares | percent.
    splitMode: text("split_mode").notNull().default("equal"),
    // Resolved per-user amounts: { userId: amount }, summing exactly to `amount`.
    // e.g. { "user1": "25.00", "user2": "25.00" } for a $50 expense split by two.
    //
    // The *keys are the participant set* — only the people who actually shared
    // this expense appear. That is the whole point: the tracker used to charge
    // every active member for every expense, so a taxi two people took was
    // billed to all five. NULL means "legacy row, split equally across all
    // current members" — see app/utils/settlement.ts.
    splits: jsonb("splits").$type<Record<string, string>>(),
    // A calendar date, not an instant: "the day the money was spent" has no
    // time and no timezone. As timestamptz it was written as UTC midnight and
    // rendered in the viewer's local zone, so everyone west of UTC saw every
    // expense dated a day early.
    paidAt: date("paid_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The list endpoint's two sort orders (#49), each with the `id` tie-break
    // the keyset pagination compares on. Both start with `trip_id`, so they
    // also serve the plain `where trip_id = ?` lookups the standalone
    // `idx_expenses_trip_id` used to cover — it was dropped as redundant.
    index("idx_expenses_trip_created_at").on(table.tripId, table.createdAt.desc(), table.id.desc()),
    index("idx_expenses_trip_paid_at").on(table.tripId, table.paidAt.desc(), table.id.desc()),
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
