import {
  pgTable,
  text,
  timestamp,
  date,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  numeric,
  integer,
  char,
  check,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import type { TripLifecycle } from "../../../shared/utils/trip-status"
import { user } from "./auth-schema"
import { itineraryDays } from "./itineraries"
import { tripIdeas } from "./trip-ideas"
import { checklists } from "./checklists"
import { expenses } from "./expenses"
import { tripMembers } from "./trip-members"
import { activityLog } from "./activity-log"
import { reservations } from "./reservations"

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(),
    name: text("name"),
    countryCode: char("country_code", { length: 2 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /**
     * Stores only the lifecycle fact a user can set: `active` or `cancelled`.
     * The status a reader sees (upcoming/ongoing/completed/cancelled) is
     * derived from the dates by `deriveTripStatus`. The column formerly held
     * derived-looking values (`draft`, `upcoming`) that nothing ever advanced.
     */
    status: text("status").notNull().default("active").$type<TripLifecycle>(),
    preferences: jsonb("preferences").$type<TripPreferences>().default({}),
    budget: numeric("budget", { precision: 10, scale: 2 }),
    currencyCode: text("currency_code").notNull().default("USD"),
    tripNotes: text("trip_notes"),
    shareToken: uuid("share_token"),
    shareExpiresAt: timestamp("share_expires_at", { mode: "date" }),
    exploreSuppressedAt: timestamp("explore_suppressed_at", { withTimezone: true }),
    /**
     * Number of rows in `expenses` for this trip, maintained by the insert and
     * delete handlers (see server/lib/expense-cap.ts).
     *
     * The cap used to be enforced with `count(*)` per insert, which both scanned
     * the table on every write and left a TOCTOU window wide enough for two
     * concurrent inserts to pass the check at 199 and land at 201. A counter on
     * the trip row makes the check O(1) and, because the incrementing UPDATE
     * takes the trip's row lock, serialises concurrent writers.
     */
    expenseCount: integer("expense_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_trips_user_id").on(table.userId),
    index("idx_trips_status").on(table.status),
    index("idx_trips_country_code").on(table.countryCode),
    uniqueIndex("idx_trips_share_token").on(table.shareToken),
    // The cap itself, in the database. The conditional UPDATE in
    // reserveExpenseSlot is what produces the 400; this is the backstop that
    // makes "at most 200" true regardless of which code path did the writing.
    check("trips_expense_count_within_cap", sql`${table.expenseCount} between 0 and 200`),
  ],
)

export const tripsRelations = relations(trips, ({ one, many }) => ({
  user: one(user, { fields: [trips.userId], references: [user.id] }),
  days: many(itineraryDays),
  ideas: many(tripIdeas),
  checklists: many(checklists),
  expenses: many(expenses),
  members: many(tripMembers),
  logs: many(activityLog),
  reservations: many(reservations),
}))

export interface TripPreferences {
  budget?: "budget" | "moderate" | "luxury"
  interests?: string[]
  pace?: "relaxed" | "moderate" | "packed"
  travelStyle?: string[]
  transportMode?: "driving" | "walking" | "transit" | "bicycling"
  /**
   * How many people are travelling. Optional and genuinely unset for most
   * trips — the AI paths fall back to the trip's member count and then to
   * saying what they assumed. Unlike its neighbours here this is a fact rather
   * than a soft signal, so the prompt builders render it in its own block
   * instead of the "soft signals" list. See server/lib/party-size.ts.
   *
   * Nullable as well as optional: clearing the field in the settings sheet
   * sends `null`, and `preferences` is written to jsonb wholesale, so the null
   * lands in the column verbatim. Every reader goes through `clampPartySize`,
   * which treats null and absent identically.
   */
  partySize?: number | null
}
