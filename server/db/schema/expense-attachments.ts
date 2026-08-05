import { pgTable, uuid, text, integer, timestamp, index, customType } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { expenses } from "./expenses"
import { trips } from "./trips"
import { user } from "./auth-schema"

/** Postgres `bytea`; drizzle has no built-in for it. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
})

/**
 * Receipt metadata — issue #48.
 *
 * `tripId` is denormalised from the expense on purpose. Every read of an
 * attachment has to prove the caller is on the *trip*, and carrying the trip on
 * the row means that check is one indexed predicate rather than a join the
 * next handler might forget to write.
 *
 * `storageKey` names the object in whatever store is configured
 * (server/lib/receipt-storage.ts). The bytes are never in this table.
 */
export const expenseAttachments = pgTable(
  "expense_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    /** One of RECEIPT_ALLOWED_MIME_TYPES, decided from the bytes, not the client. */
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedById: text("uploaded_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_expense_attachments_expense").on(table.expenseId, table.createdAt),
    index("idx_expense_attachments_trip").on(table.tripId),
  ],
)

export const expenseAttachmentsRelations = relations(expenseAttachments, ({ one }) => ({
  expense: one(expenses, { fields: [expenseAttachments.expenseId], references: [expenses.id] }),
  trip: one(trips, { fields: [expenseAttachments.tripId], references: [trips.id] }),
  uploadedBy: one(user, { fields: [expenseAttachments.uploadedById], references: [user.id] }),
}))

/**
 * The bytes, for the `database` storage driver only.
 *
 * This table is an implementation detail of that one driver — nothing outside
 * server/lib/receipt-storage.ts should read it, and a deployment that binds an
 * object store instead will simply leave it empty. See the storage note in that
 * file: which driver production uses is an open decision.
 */
export const storedObjects = pgTable("stored_objects", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
