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
  char,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
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
    status: text("status").notNull().default("upcoming"),
    preferences: jsonb("preferences").$type<TripPreferences>().default({}),
    budget: numeric("budget", { precision: 10, scale: 2 }),
    currencyCode: text("currency_code").notNull().default("USD"),
    tripNotes: text("trip_notes"),
    shareToken: uuid("share_token"),
    shareExpiresAt: timestamp("share_expires_at", { mode: "date" }),
    exploreSuppressedAt: timestamp("explore_suppressed_at", { withTimezone: true }),
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
}
