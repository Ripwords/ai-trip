import { and, asc, desc, eq, notInArray } from "drizzle-orm"
import { db } from "../db"
import { tripChatMessages } from "../db/schema"
import type { Proposal } from "../../shared/utils/discuss-sse"

export type ChatMessageRole = "user" | "assistant"

/**
 * How many rows one (trip, user) thread keeps. Expenses cap at 200 per trip and
 * REJECT the 201st, which is right for a list the user curates by hand. A chat
 * log is appended by the machine two rows at a time, so rejecting would brick
 * the feature; it prunes instead. 100 rows is ~50 turns — comfortably more than
 * the 20-message window the endpoint actually replays to the model, so the cap
 * never truncates anything the agent would have seen anyway, while bounding the
 * table at (trips x members x 100) instead of unbounded.
 */
export const CHAT_HISTORY_LIMIT = 100

/**
 * Matches the discuss endpoint's own `content: z.string().max(4000)` bound, so
 * a stored message can always be replayed back through that schema. Assistant
 * replies are not length-checked anywhere upstream, so this is where a runaway
 * generation stops being a storage problem.
 */
export const CHAT_MESSAGE_MAX_CHARS = 4000

export interface StoredChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  toolCallSummary: string[]
  proposals: Proposal[]
  createdAt: Date
}

export interface NewChatRow {
  tripId: string
  userId: string
  role: ChatMessageRole
  content: string
  toolCallSummary: string[]
  proposals: Proposal[]
  createdAt: Date
}

/** The persistence port, injectable so the rules below are unit-testable. */
export interface ChatStore {
  /** Insert every row in ONE statement — see persistChatTurn. */
  insertMessages: (rows: NewChatRow[]) => Promise<void>
  /** Delete all but the newest `keep` rows of one thread. Returns rows removed. */
  pruneThread: (tripId: string, userId: string, keep: number) => Promise<number>
  /** Newest `limit` rows of one thread, oldest-first. */
  listThread: (tripId: string, userId: string, limit: number) => Promise<StoredChatMessage[]>
  /** Delete one thread. Returns rows removed. */
  clearThread: (tripId: string, userId: string) => Promise<number>
}

function threadWhere(tripId: string, userId: string) {
  // Both columns, always. A `where` that dropped userId would silently turn the
  // per-user thread into a trip-wide one (issue #57's failure mode), so this is
  // the single place it is written.
  return and(eq(tripChatMessages.tripId, tripId), eq(tripChatMessages.userId, userId))
}

function toStored(row: {
  id: string
  role: string
  content: string
  toolCallSummary: string[]
  proposals: unknown[]
  createdAt: Date
}): StoredChatMessage {
  return {
    id: row.id,
    // The column is plain text; anything that is not a known role is read as a
    // user turn rather than crashing the history load.
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    toolCallSummary: row.toolCallSummary ?? [],
    proposals: (row.proposals ?? []) as Proposal[],
    createdAt: row.createdAt,
  }
}

export const dbChatStore: ChatStore = {
  insertMessages: async (rows) => {
    if (rows.length === 0) return
    await db.insert(tripChatMessages).values(rows)
  },
  pruneThread: async (tripId, userId, keep) => {
    const survivors = db
      .select({ id: tripChatMessages.id })
      .from(tripChatMessages)
      .where(threadWhere(tripId, userId))
      .orderBy(desc(tripChatMessages.createdAt), desc(tripChatMessages.id))
      .limit(keep)
    const removed = await db
      .delete(tripChatMessages)
      .where(and(threadWhere(tripId, userId), notInArray(tripChatMessages.id, survivors)))
      .returning({ id: tripChatMessages.id })
    return removed.length
  },
  listThread: async (tripId, userId, limit) => {
    // Newest `limit` rows, then flipped to oldest-first for rendering — the
    // opposite order would return the OLDEST window on a long thread.
    const rows = await db
      .select()
      .from(tripChatMessages)
      .where(threadWhere(tripId, userId))
      .orderBy(desc(tripChatMessages.createdAt), desc(tripChatMessages.id))
      .limit(limit)
    return rows.toReversed().map(toStored)
  },
  clearThread: async (tripId, userId) => {
    const removed = await db
      .delete(tripChatMessages)
      .where(threadWhere(tripId, userId))
      .returning({ id: tripChatMessages.id })
    return removed.length
  },
}

export interface ChatTurn {
  tripId: string
  userId: string
  /** The user's own text — NOT the trip-context-prefixed copy sent to the model. */
  userContent: string
  /** The assistant's FULL reply. Only meaningful when `aborted` is false. */
  assistantContent: string
  toolCallSummary: string[]
  proposals: Proposal[]
  /** True when the stream was cancelled or the connection dropped mid-answer. */
  aborted: boolean
}

export type PersistResult =
  | { persisted: true }
  | { persisted: false; reason: "aborted" | "empty" | "error" }

function clamp(text: string): string {
  return text.length > CHAT_MESSAGE_MAX_CHARS ? text.slice(0, CHAT_MESSAGE_MAX_CHARS) : text
}

/**
 * Write one completed discuss turn to the transcript.
 *
 * Called from the endpoint AFTER credits are settled and after the `done` frame
 * has shipped, and therefore bound by two rules:
 *
 *  1. **Only complete turns.** An aborted stream (Cancel, tab closed, function
 *     timeout) holds a half-written sentence. Storing it would both show a
 *     truncated reply forever and feed that truncation back into the model's
 *     context on the next turn, since the client replays history. The turn is
 *     still METERED — those steps were really spent — it is just not recorded.
 *  2. **It never throws.** Credits are already settled and non-idempotent; an
 *     exception escaping here would reach the endpoint's catch, which would
 *     re-enter the settle guard and could push an `error` frame for a turn the
 *     client already saw succeed. A failed write loses a transcript row, which
 *     is strictly cheaper than a mis-billed turn.
 */
export async function persistChatTurn(
  turn: ChatTurn,
  store: ChatStore = dbChatStore,
): Promise<PersistResult> {
  if (turn.aborted) return { persisted: false, reason: "aborted" }

  const userContent = clamp(turn.userContent.trim())
  const assistantContent = clamp(turn.assistantContent.trim())
  // Same "did the user get anything" predicate the endpoint bills on: text OR
  // proposals. A proposal-only turn is a real answer and is recorded.
  const gotSomething = assistantContent.length > 0 || turn.proposals.length > 0
  if (!userContent || !gotSomething) return { persisted: false, reason: "empty" }

  // Explicit, distinct timestamps: Postgres' now() is transaction-stable, so
  // two rows inserted by one statement would share a created_at and the
  // transcript would render the reply before the question at random.
  const now = Date.now()

  try {
    // One statement for both rows: a failure mid-turn must not leave a question
    // with no answer in the history that gets replayed to the model.
    await store.insertMessages([
      {
        tripId: turn.tripId,
        userId: turn.userId,
        role: "user",
        content: userContent,
        toolCallSummary: [],
        proposals: [],
        createdAt: new Date(now),
      },
      {
        tripId: turn.tripId,
        userId: turn.userId,
        role: "assistant",
        content: assistantContent,
        toolCallSummary: turn.toolCallSummary,
        proposals: turn.proposals,
        createdAt: new Date(now + 1),
      },
    ])
  } catch (e: unknown) {
    console.error("[trip-chat] failed to persist chat turn:", e)
    return { persisted: false, reason: "error" }
  }

  try {
    await store.pruneThread(turn.tripId, turn.userId, CHAT_HISTORY_LIMIT)
  } catch (e: unknown) {
    // The turn IS stored; the thread is just one pair over the cap and the next
    // successful turn trims it. Not worth reporting as a failed persist.
    console.error("[trip-chat] failed to prune chat thread:", e)
  }

  return { persisted: true }
}

/** The caller's own thread for a trip, oldest-first, capped at CHAT_HISTORY_LIMIT. */
export async function loadChatHistory(
  tripId: string,
  userId: string,
  store: ChatStore = dbChatStore,
): Promise<StoredChatMessage[]> {
  return store.listThread(tripId, userId, CHAT_HISTORY_LIMIT)
}

/** Delete the caller's own thread for a trip. Returns the number of rows removed. */
export async function clearChatThread(
  tripId: string,
  userId: string,
  store: ChatStore = dbChatStore,
): Promise<number> {
  return store.clearThread(tripId, userId)
}
