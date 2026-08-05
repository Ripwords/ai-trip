import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
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
    //
    // `numeric(10,2)` capped at 99,999,999.99, which is about USD 3,800 in VND.
    // Once an expense carries its own currency, a large zero-decimal amount is
    // reachable on any trip and overflowed with a raw `22003` — an unhandled
    // 500 with no way for the user to tell what went wrong.
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    // The currency the payment was made in — a Japan/Korea trip has two, and a
    // card-issuer rate differs from the mid-market one.
    //
    // NULL means "provenance unknown", and only ever applies to rows that
    // predate this column. It is not a default anyone can write: every insert
    // path resolves a real code. See migration 0043 for why those rows are not
    // simply stamped with their trip's currency — briefly, `PUT /api/trips/:id`
    // once let `currencyCode` be swapped without converting a single stored
    // amount (#53, commit 77c5f34), and nothing in the activity log records
    // that it happened, so asserting a code for those rows would permanently
    // misstate what someone paid.
    currencyCode: text("currency_code"),
    // Rate from `currencyCode` to the trip's currency, as at the last time this
    // row was projected. Recorded so a report can be explained rather than
    // merely asserted. NULL exactly when `currencyCode` is NULL: with no known
    // source currency there is no rate to state.
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    // DERIVED reporting projection: `amount` converted into the trip's currency
    // and rounded to its precision. Re-derived from the immutable `amount` on
    // every trip-currency change; never chained off its own previous value.
    //
    // NOT NULL, and that is load-bearing. While it was nullable every read path
    // carried a `COALESCE(..., amount)` fallback, and `amount` is denominated in
    // the *expense's* currency — so a ¥3,200 row on a USD trip was read as
    // $3,200.00. Making the column total makes that category error
    // unrepresentable rather than something each new reader has to remember.
    amountInTripCurrency: numeric("amount_in_trip_currency", {
      precision: 16,
      scale: 2,
    }).notNull(),
    category: text("category").notNull().default("other"),
    // Who paid for this expense
    paidById: text("paid_by_id").references(() => user.id, { onDelete: "set null" }),
    // How `splits` below was derived, so the edit form can round-trip the
    // user's intent rather than only its resolved output.
    // One of shared/utils/splits.ts SPLIT_MODES: equal | exact | shares | percent.
    splitMode: text("split_mode").notNull().default("equal"),
    // Resolved per-user amounts: { userId: amount }, summing exactly to
    // `amount` and denominated in `currencyCode`, e.g. { "user1": "25.00",
    // "user2": "25.00" } for a $50 expense split by two.
    //
    // The *keys are the participant set* — only the people who actually shared
    // this expense appear. That is the whole point: the tracker used to charge
    // every active member for every expense, so a taxi two people took was
    // billed to all five.
    //
    // NULL is the explicit default for "an equal split across whoever is on the
    // trip", not a legacy marker: storing a snapshot of today's roster would
    // keep charging the old set forever. See shared/utils/settlement.ts, which
    // resolves it at read time.
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
    // `currency_code` is NULL only for rows predating #47, and `fx_rate` is
    // meaningful only when there is a source currency to convert from — so the
    // two are unknown together or known together, never one without the other.
    // Stated here so the database enforces it rather than every write path
    // remembering to.
    check(
      "expenses_currency_provenance_check",
      sql`(${table.currencyCode} IS NULL) = (${table.fxRate} IS NULL)`,
    ),
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
