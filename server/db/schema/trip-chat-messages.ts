import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { trips } from "./trips"
import { user } from "./auth-schema"

/**
 * The persisted discuss-agent transcript.
 *
 * Threads are scoped to (trip_id, user_id), NOT to the trip alone. A trip is
 * shareable, but the conversation is one member's own prompts — "book the
 * surprise dinner for her birthday" belongs to whoever typed it. Making it
 * trip-wide would repeat the class of leak recorded in issue #57 (user-scoped
 * data widened to every co-editor by mirroring it into a trip-scoped table).
 * Every read/write path filters on BOTH columns; the composite index below
 * exists so that filter is also the cheap one.
 *
 * Content is stored as plain text, like trip notes and activity descriptions —
 * `encryptedText` is reserved here for identifiers (passport numbers,
 * confirmation numbers), and encrypting the transcript would make the retention
 * prune and any future search impossible without a full table decrypt.
 */
export const tripChatMessages = pgTable(
  "trip_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    // Losing the account drops the transcript with it — there is no such thing
    // as an ownerless chat thread.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** The "checked the day's schedule" progress lines shown under a reply. */
    toolCallSummary: jsonb("tool_call_summary").$type<string[]>().notNull().default([]),
    /** The proposal cards the turn produced, kept for the transcript record. */
    proposals: jsonb("proposals").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Ordered by created_at so both the history read and the retention prune
    // (newest-N per thread) are index-ordered scans of one thread.
    index("idx_trip_chat_messages_thread").on(table.tripId, table.userId, table.createdAt),
  ],
)

export const tripChatMessagesRelations = relations(tripChatMessages, ({ one }) => ({
  trip: one(trips, { fields: [tripChatMessages.tripId], references: [trips.id] }),
  user: one(user, { fields: [tripChatMessages.userId], references: [user.id] }),
}))
