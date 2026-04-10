import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { reservations } from "./reservations"
import { user } from "./auth-schema"

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    size: integer("size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedById: text("uploaded_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_documents_trip_id").on(table.tripId),
    index("idx_documents_reservation_id").on(table.reservationId),
  ],
)

export const documentsRelations = relations(documents, ({ one }) => ({
  trip: one(trips, { fields: [documents.tripId], references: [trips.id] }),
  reservation: one(reservations, {
    fields: [documents.reservationId],
    references: [reservations.id],
  }),
  uploadedBy: one(user, { fields: [documents.uploadedById], references: [user.id] }),
}))
