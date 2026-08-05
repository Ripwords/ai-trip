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
    /**
     * What the user decided about each proposal, keyed by proposal id:
     * `{ "<proposal id>": { "state": "applied" | "dismissed", "dayVersion": "<iso>" } }`.
     *
     * Sparse on purpose — an absent key means "not acted on", so a fresh turn
     * stores `{}` and a decision is only ever an addition. Without this the
     * restore path had no way to tell an applied proposal from an untouched
     * one and stamped every restored card "dismissed", which hid the `Applied`
     * receipt and the Undo button along with the card.
     *
     * `dayVersion` is the target day's `itinerary_days.updated_at` at the moment the
     * proposal was applied — the watermark that says whether a LATER edit has
     * since superseded it. Written server-side from the same clock it is
     * compared against; never taken from the client.
     */
    proposalStates: jsonb("proposal_states")
      .$type<Record<string, { state: string; dayVersion?: string }>>()
      .notNull()
      .default({}),
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
