import { pgTable, uuid, text, numeric, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { encryptedText } from "../custom-types"
import { trips } from "./trips"
import { user } from "./auth-schema"
import { documents } from "./documents"

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("other"),
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
  ],
)

export const reservationsRelations = relations(reservations, ({ one, many }) => ({
  trip: one(trips, { fields: [reservations.tripId], references: [trips.id] }),
  createdBy: one(user, { fields: [reservations.createdById], references: [user.id] }),
  documents: many(documents),
}))
