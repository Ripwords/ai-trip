import { pgTable, uuid, text, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { encryptedText } from "../custom-types"
import { trips } from "./trips"
import { stays } from "./stays"
import { user } from "./auth-schema"

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("other"),
    // Where this row came from: 'manual' (typed by hand) or 'stay' (mirrored
    // from a `stays` row). `type` stays the display discriminator — restaurant
    // and car_rental rows legitimately have no source entity. `source` is what
    // tells the UI "this row is derived, only prompt for the gaps".
    // Flights are deliberately absent: they are user-scoped while reservations
    // are trip-scoped, so mirroring them would leak a member's flights to every
    // co-editor. See #57.
    source: text("source").notNull().default("manual"),
    stayId: uuid("stay_id").references(() => stays.id, { onDelete: "set null" }),
    // Set when a derived row was unlinked (the hotel was cleared or changed).
    // The row survives as a fully editable manual booking — this is only so the
    // UI can say "no longer linked" instead of silently looking hand-typed.
    detachedAt: timestamp("detached_at", { withTimezone: true }),
    status: text("status").notNull().default("confirmed"),
    name: text("name").notNull(),
    confirmationNumber: encryptedText("confirmation_number"),
    provider: text("provider"),
    notes: text("notes"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    amount: numeric("amount", { precision: 10, scale: 2 }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_reservations_trip_id").on(table.tripId),
    index("idx_reservations_type").on(table.type),
    index("idx_reservations_status").on(table.status),
    index("idx_reservations_created_by").on(table.createdById),
    // Load-bearing: without it every repeated accommodation edit spawns
    // another booking row for the same stay.
    uniqueIndex("idx_reservations_stay")
      .on(table.stayId)
      .where(sql`stay_id IS NOT NULL`),
  ],
)

export const reservationsRelations = relations(reservations, ({ one }) => ({
  trip: one(trips, { fields: [reservations.tripId], references: [trips.id] }),
  stay: one(stays, { fields: [reservations.stayId], references: [stays.id] }),
  createdBy: one(user, { fields: [reservations.createdById], references: [user.id] }),
}))
