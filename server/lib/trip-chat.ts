import { and, desc, eq, notInArray, sql } from "drizzle-orm"
import { db } from "../db"
import { itineraryDays, tripChatMessages } from "../db/schema"
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

/**
 * What a proposal card can be, once a thread has been reloaded from the table.
 *
 * Three states, not two. Before this existed the restore path collapsed all of
 * them into "dismissed" — which hid the card, and with it the `Applied` stamp
 * and the Undo button that live inside it — because nothing recorded which
 * proposals had actually been acted on. The distinction that matters:
 *
 *  - `applied`   — the user pressed Apply and the write succeeded. The card is
 *                  a receipt: it must show the stamp, never an Apply button.
 *  - `dismissed` — the user said no. Stays hidden.
 *  - `pending`   — never acted on. Still a real, un-answered suggestion, and
 *                  applying it now cannot duplicate anything, precisely BECAUSE
 *                  `applied` is recorded separately. See the note on
 *                  `resolveProposalStates`.
 */
export type ProposalState = "pending" | "applied" | "dismissed"

/**
 * The subset that is written down. `pending` is the absence of a decision, so
 * it is stored as a missing key rather than a value — a message with no
 * decisions carries `{}`, and a proposal only ever gains a key when the user
 * does something. `applying` is a transient UI state during the request and is
 * deliberately not representable here.
 */
export type PersistedProposalState = Exclude<ProposalState, "pending">

/** One entry of the `proposal_states` jsonb map, as stored. */
export interface StoredDecision {
  state: string
  /**
   * The target day's `itinerary_days.updated_at` at the instant this was applied.
   * Absent on a dismissal (a dismissed card is never actionable again) and on
   * rows written before this column existed.
   */
  dayVersion?: string
}

/**
 * A proposal's state after a reload, plus whether a LATER edit has overtaken it.
 *
 * Supersession is the itinerary equivalent of a commit that no longer sits at
 * the tip of the branch. A proposal reasoned about the day as it was; once
 * anything else has changed that day — by any member, through any write path —
 * that reasoning is stale:
 *
 *  - applied + superseded: Undo would restore a snapshot from BEFORE the later
 *    edits and silently discard them. Undo must be refused, not merely risky.
 *  - pending + superseded: applying now re-runs a change proposed against an
 *    itinerary that has moved on — the original hazard that the old
 *    "restore everything as dismissed" code was (bluntly) guarding against.
 *
 * `superseded` is deliberately conservative: an unknown day, or an applied
 * decision with no watermark, reads as superseded, because the honest answer to
 * "can I safely act on this?" without evidence is no.
 */
export interface ResolvedProposalState {
  state: ProposalState
  superseded: boolean
}

export interface StoredChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  toolCallSummary: string[]
  proposals: Proposal[]
  /** RAW, as the jsonb column holds it — sparse, and not validated. */
  proposalStates: Record<string, StoredDecision>
  createdAt: Date
}

/** A row as the client gets it: every proposal id resolved to a real state. */
export interface ChatHistoryMessage extends Omit<StoredChatMessage, "proposalStates"> {
  proposalStates: Record<string, ResolvedProposalState>
}

export interface NewChatRow {
  /**
   * Assigned by the caller instead of the column default, so the discuss
   * endpoint can hand the id to the browser in its `done` frame — the client
   * needs a name for this row to record Apply/Dismiss against.
   */
  id?: string
  tripId: string
  userId: string
  role: ChatMessageRole
  content: string
  toolCallSummary: string[]
  proposals: Proposal[]
  proposalStates: Record<string, StoredDecision>
  createdAt: Date
}

export interface SetProposalStateArgs {
  tripId: string
  userId: string
  messageId: string
  proposalId: string
  state: PersistedProposalState
  /**
   * The day's `itinerary_days.updated_at` AFTER the apply that this records. Read
   * server-side from the same column it will later be compared against — a
   * client-supplied wall clock could not be compared to it safely, and could be
   * inflated to keep a superseded Undo enabled.
   */
  dayVersion?: Date
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
  /**
   * Merge ONE proposal's decision into one message. Must match the message id
   * AND both thread columns, and the proposal id must already be present in
   * that row's `proposals`. Returns false when nothing matched.
   */
  setProposalState: (args: SetProposalStateArgs) => Promise<boolean>
  /**
   * `itinerary_days.updated_at` for every day of one trip, keyed by day id. Lives on
   * this port so the supersession rules below stay unit-testable; a day missing
   * from the map has been deleted.
   */
  listDayVersions: (tripId: string) => Promise<Record<string, Date>>
}

function isPersistedState(value: unknown): value is PersistedProposalState {
  return value === "applied" || value === "dismissed"
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Project the sparse stored map onto exactly the proposals the message carries,
 * and decide which of them a later edit has overtaken.
 *
 * Keyed on the proposals, not on the stored map, so the result has one entry per
 * card and the client never has to invent a default. Two things are dropped on
 * the way: keys for proposals that are no longer on the message, and any value
 * that is not a state we write (the column is jsonb — `applying`, or anything
 * else, reads as `pending`, which is the state that offers the user a choice
 * rather than one that silently claims a change was made).
 *
 * The two comparisons are STRICTLY greater-than, which is what makes an apply
 * survive its own side effect: applying bumps the day's `itinerary_days.updated_at`
 * via the trigger, and the watermark stored for that apply is that exact value,
 * so it reads as equal — unchanged — rather than instantly superseding itself.
 */
export function resolveProposalStates(
  proposals: Proposal[],
  stored: Record<string, StoredDecision> | null | undefined,
  ctx: {
    /** `itinerary_days.updated_at` per day id. A missing day was deleted. */
    dayVersions: Record<string, Date>
    /** When the assistant made these proposals — the pending baseline. */
    proposedAt: Date
  },
): Record<string, ResolvedProposalState> {
  const raw = stored ?? {}
  const out: Record<string, ResolvedProposalState> = {}
  for (const p of proposals) {
    const decision: StoredDecision | undefined = raw[p.id]
    const state: ProposalState = isPersistedState(decision?.state) ? decision.state : "pending"
    const dayVersion = ctx.dayVersions[p.dayId]

    if (state === "dismissed") {
      // Terminal. The card stays hidden either way, and calling it superseded
      // would only invite a UI that explains something the user already closed.
      out[p.id] = { state, superseded: false }
      continue
    }

    if (state === "applied") {
      const appliedAt = toDate(decision?.dayVersion)
      out[p.id] = {
        state,
        // No day (deleted) or no watermark (written before this shipped) means
        // there is nothing to prove Undo is still safe against.
        superseded: !dayVersion || !appliedAt || dayVersion.getTime() > appliedAt.getTime(),
      }
      continue
    }

    // Pending: the baseline is when the assistant proposed it. `proposedAt` is
    // assigned by the app and `dayVersion` by Postgres, so this comparison is
    // across two clocks — tolerable here because the question is "has the day
    // been edited since this suggestion", measured in minutes and sessions, not
    // milliseconds. The applied branch above, where a millisecond decides
    // whether Undo is offered, deliberately compares two values of the SAME
    // column instead.
    out[p.id] = {
      state,
      superseded: !dayVersion || dayVersion.getTime() > ctx.proposedAt.getTime(),
    }
  }
  return out
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
  proposalStates: Record<string, StoredDecision>
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
    proposalStates: row.proposalStates ?? {},
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
  setProposalState: async ({ tripId, userId, messageId, proposalId, state, dayVersion }) => {
    const decision: StoredDecision = {
      state,
      ...(dayVersion ? { dayVersion: dayVersion.toISOString() } : {}),
    }
    const updated = await db
      .update(tripChatMessages)
      .set({
        // `||` merges one key into the existing object. Read-modify-write in JS
        // would clobber a concurrent decision on a sibling proposal (Apply all
        // fires these one per card); this is a single statement per key.
        proposalStates: sql`${tripChatMessages.proposalStates} || ${JSON.stringify({ [proposalId]: decision })}::jsonb`,
      })
      .where(
        and(
          eq(tripChatMessages.id, messageId),
          // The thread filter, not just the id: a message id is a uuid a
          // co-traveller could hold from their own transcript, and without both
          // columns this would let them stamp decisions on someone else's.
          threadWhere(tripId, userId),
          // The proposal must really be on this message. Without this the
          // column is an unbounded key-value store any authenticated member can
          // write arbitrary keys into, on their own rows.
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${tripChatMessages.proposals}) AS e WHERE e->>'id' = ${proposalId})`,
        ),
      )
      .returning({ id: tripChatMessages.id })
    return updated.length > 0
  },
  listDayVersions: async (tripId) => {
    const rows = await db
      .select({ id: itineraryDays.id, updatedAt: itineraryDays.updatedAt })
      .from(itineraryDays)
      .where(eq(itineraryDays.tripId, tripId))
    return Object.fromEntries(rows.map((r) => [r.id, r.updatedAt]))
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
  /** The id the assistant row must be stored under — see NewChatRow.id. */
  assistantMessageId?: string
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
        proposalStates: {},
        createdAt: new Date(now),
      },
      {
        ...(turn.assistantMessageId ? { id: turn.assistantMessageId } : {}),
        tripId: turn.tripId,
        userId: turn.userId,
        role: "assistant",
        content: assistantContent,
        toolCallSummary: turn.toolCallSummary,
        proposals: turn.proposals,
        // No decisions yet. Every card starts pending, which is the absence of
        // a key rather than a stored value.
        proposalStates: {},
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

/**
 * The caller's own thread for a trip, oldest-first, capped at CHAT_HISTORY_LIMIT,
 * with every proposal resolved to a state and a supersession verdict.
 *
 * The day versions are read once for the whole thread rather than per message —
 * a 100-row transcript can reference the same handful of days many times over.
 */
export async function loadChatHistory(
  tripId: string,
  userId: string,
  store: ChatStore = dbChatStore,
): Promise<ChatHistoryMessage[]> {
  const [rows, dayVersions] = await Promise.all([
    store.listThread(tripId, userId, CHAT_HISTORY_LIMIT),
    store.listDayVersions(tripId),
  ])
  return rows.map((row) => ({
    ...row,
    proposalStates: resolveProposalStates(row.proposals, row.proposalStates, {
      dayVersions,
      proposedAt: row.createdAt,
    }),
  }))
}

export type RecordProposalStateResult =
  | { recorded: true }
  | { recorded: false; reason: "not-found" | "error" }

/**
 * Record one Apply/Dismiss decision against the caller's OWN transcript.
 *
 * Never throws, for the same reason `persistChatTurn` does not: it runs after
 * the itinerary write it describes has already succeeded. Losing the bookkeeping
 * degrades a restored card to `pending` (actionable, at worst re-applied by
 * hand); reporting a completed apply as failed does not degrade, it misleads.
 * `not-found` and `error` are kept apart so the route can answer 404 for a
 * message the caller does not own and 500 for a database fault.
 */
export async function recordProposalState(
  args: SetProposalStateArgs,
  store: ChatStore = dbChatStore,
): Promise<RecordProposalStateResult> {
  try {
    const matched = await store.setProposalState(args)
    return matched ? { recorded: true } : { recorded: false, reason: "not-found" }
  } catch (e: unknown) {
    console.error("[trip-chat] failed to record proposal state:", e)
    return { recorded: false, reason: "error" }
  }
}

/** Delete the caller's own thread for a trip. Returns the number of rows removed. */
export async function clearChatThread(
  tripId: string,
  userId: string,
  store: ChatStore = dbChatStore,
): Promise<number> {
  return store.clearThread(tripId, userId)
}
