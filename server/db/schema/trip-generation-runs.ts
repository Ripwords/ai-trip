import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { trips } from "./trips"
import { itineraryDays } from "./itineraries"
import { user } from "./auth-schema"

/** Stored so a resumed run reuses the plan the traveler already paid for. */
export interface StoredOutline {
  days: {
    dayId: string
    dayNumber: number
    theme: string
    focusArea: string
    mustInclude: string[]
    guidance: string
  }[]
  avoidRepeats: string[]
}

export const tripGenerationRuns = pgTable(
  "trip_generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** running → completed | cancelled. Only one `running` run per trip. */
    status: text("status").notNull().default("running"),
    /** `outline` when a trip-level plan was produced, `generic` when it wasn't. */
    mode: text("mode").notNull().default("generic"),
    outline: jsonb("outline").$type<StoredOutline>(),
    /** Credits this run has actually billed — outline plus each claimed day. */
    creditsCharged: integer("credits_charged").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_trip_generation_runs_trip_id").on(table.tripId),
    // At most one active run per trip. Two tabs pressing "Generate" at the
    // same moment therefore cannot both create a run and both charge for an
    // outline — the loser's INSERT is rejected and it resumes instead.
    uniqueIndex("idx_trip_generation_runs_active")
      .on(table.tripId)
      .where(sql`status = 'running'`),
  ],
)

export const tripGenerationRunDays = pgTable(
  "trip_generation_run_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => tripGenerationRuns.id, { onDelete: "cascade" }),
    dayId: uuid("day_id")
      .notNull()
      .references(() => itineraryDays.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    /** pending → in_progress → succeeded | failed. */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** When the current `in_progress` claim was taken; drives staleness. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A day appears at most once per run, so the conditional claim UPDATE
    // touches exactly one row.
    uniqueIndex("idx_trip_generation_run_days_run_day").on(table.runId, table.dayId),
  ],
)

export const tripGenerationRunsRelations = relations(tripGenerationRuns, ({ one, many }) => ({
  trip: one(trips, { fields: [tripGenerationRuns.tripId], references: [trips.id] }),
  days: many(tripGenerationRunDays),
}))

export const tripGenerationRunDaysRelations = relations(tripGenerationRunDays, ({ one }) => ({
  run: one(tripGenerationRuns, {
    fields: [tripGenerationRunDays.runId],
    references: [tripGenerationRuns.id],
  }),
  day: one(itineraryDays, {
    fields: [tripGenerationRunDays.dayId],
    references: [itineraryDays.id],
  }),
}))
