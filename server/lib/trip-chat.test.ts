;(
  globalThis as { createError?: (input: { statusCode?: number; message?: string }) => Error }
).createError = (input) => Object.assign(new Error(input.message ?? ""), input)
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ChatStore, NewChatRow, SetProposalStateArgs, StoredChatMessage } from "./trip-chat"

const {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_CHARS,
  clearChatThread,
  loadChatHistory,
  persistChatTurn,
  recordProposalState,
} = await import("./trip-chat")

const TRIP = "11111111-1111-1111-1111-111111111111"
const OTHER_TRIP = "22222222-2222-2222-2222-222222222222"
const ALICE = "alice"
const BOB = "bob"

interface Row extends NewChatRow {
  id: string
  createdAt: Date
}

/**
 * An in-memory stand-in for the real table that ACTUALLY enforces the thread
 * filter. A store that ignored tripId/userId would let the authz tests below
 * pass vacuously — the exact failure mode the audit flagged — so every read and
 * delete here matches on both columns and nothing else.
 */
class FakeStore implements ChatStore {
  rows: Row[] = []
  /** `itinerary_days.updated_at` per day, per trip — keyed by trip so the read below
   * has a wrong answer available to return if it ever stops filtering. */
  dayVersions: Record<string, Record<string, Date>> = {}
  private seq = 0

  async listDayVersions(tripId: string): Promise<Record<string, Date>> {
    return this.dayVersions[tripId] ?? {}
  }

  seed(row: Partial<Row> & { tripId: string; userId: string; role: "user" | "assistant" }) {
    this.rows.push({
      id: `seed-${this.seq}`,
      content: row.content ?? "seeded",
      toolCallSummary: row.toolCallSummary ?? [],
      proposals: row.proposals ?? [],
      proposalStates: row.proposalStates ?? {},
      createdAt: row.createdAt ?? new Date(1_000 + this.seq),
      ...row,
    } as Row)
    this.seq++
  }

  /**
   * Mirrors the SQL in `dbChatStore.setProposalState` clause for clause: the
   * row must match the message id AND BOTH thread columns, and the proposal id
   * must already exist inside that row's `proposals`. A fake that skipped
   * either check would let the authz and forged-id tests below pass while the
   * real statement was wrong.
   */
  async setProposalState(args: SetProposalStateArgs): Promise<boolean> {
    const row = this.rows.find(
      (r) => r.id === args.messageId && r.tripId === args.tripId && r.userId === args.userId,
    )
    if (!row) return false
    const known = (row.proposals as { id?: unknown }[]).some((p) => p.id === args.proposalId)
    if (!known) return false
    row.proposalStates = {
      ...row.proposalStates,
      [args.proposalId]: {
        state: args.state,
        ...(args.dayVersion ? { dayVersion: args.dayVersion.toISOString() } : {}),
      },
    }
    return true
  }

  async insertMessages(rows: NewChatRow[]): Promise<void> {
    for (const r of rows) {
      // Keeps the caller-supplied createdAt: Postgres' now() is
      // transaction-stable, so the app assigns them and ordering depends on it.
      // Same for the id — the column has a default, but a supplied one wins,
      // and the discuss endpoint hands that id to the browser.
      this.rows.push({ ...r, id: r.id ?? `ins-${this.seq}` })
      this.seq++
    }
  }

  private thread(tripId: string, userId: string): Row[] {
    return this.rows
      .filter((r) => r.tripId === tripId && r.userId === userId)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async pruneThread(tripId: string, userId: string, keep: number): Promise<number> {
    const thread = this.thread(tripId, userId)
    const doomed = new Set(thread.slice(0, Math.max(thread.length - keep, 0)).map((r) => r.id))
    this.rows = this.rows.filter((r) => !doomed.has(r.id))
    return doomed.size
  }

  async listThread(tripId: string, userId: string, limit: number): Promise<StoredChatMessage[]> {
    return this.thread(tripId, userId)
      .slice(-limit)
      .map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        toolCallSummary: r.toolCallSummary,
        proposals: r.proposals,
        // Raw, exactly as the jsonb column holds it — resolving to the
        // three-state model is `loadChatHistory`'s job and is under test.
        proposalStates: r.proposalStates,
        createdAt: r.createdAt,
      }))
  }

  async clearThread(tripId: string, userId: string): Promise<number> {
    const before = this.rows.length
    this.rows = this.rows.filter((r) => !(r.tripId === tripId && r.userId === userId))
    return before - this.rows.length
  }
}

function turn(overrides: Partial<Parameters<typeof persistChatTurn>[0]> = {}) {
  return {
    tripId: TRIP,
    userId: ALICE,
    userContent: "Where should I eat on day 2?",
    assistantContent: "Try Tsuta for ramen.",
    toolCallSummary: ["searched Google Maps for 'ramen'"],
    proposals: [],
    aborted: false,
    ...overrides,
  }
}

describe("persistChatTurn", () => {
  it("stores the user turn and the assistant reply with their real content", async () => {
    const store = new FakeStore()
    const result = await persistChatTurn(turn(), store)

    assert.equal(result.persisted, true)
    assert.equal(store.rows.length, 2)
    const [user, assistant] = store.rows
    assert.equal(user!.role, "user")
    assert.equal(user!.content, "Where should I eat on day 2?")
    assert.equal(user!.tripId, TRIP)
    assert.equal(user!.userId, ALICE)
    assert.deepEqual(user!.toolCallSummary, [])
    assert.equal(assistant!.role, "assistant")
    assert.equal(assistant!.content, "Try Tsuta for ramen.")
    assert.deepEqual(assistant!.toolCallSummary, ["searched Google Maps for 'ramen'"])
    // Timestamps must be STRICTLY ordered: both rows go in one statement, so a
    // DB-assigned now() would tie and the transcript could render the reply
    // above the question.
    assert.ok(
      user!.createdAt.getTime() < assistant!.createdAt.getTime(),
      "user turn must sort strictly before its reply",
    )
  })

  it("writes both rows in a SINGLE store call so a crash cannot orphan the user turn", async () => {
    const store = new FakeStore()
    const batches: number[] = []
    const spy: ChatStore = {
      ...store,
      insertMessages: async (rows) => {
        batches.push(rows.length)
        await store.insertMessages(rows)
      },
      pruneThread: (t, u, k) => store.pruneThread(t, u, k),
      listThread: (t, u, l) => store.listThread(t, u, l),
      clearThread: (t, u) => store.clearThread(t, u),
      setProposalState: (a) => store.setProposalState(a),
      listDayVersions: (t) => store.listDayVersions(t),
    }
    await persistChatTurn(turn(), spy)
    assert.deepEqual(batches, [2])
  })

  it("persists proposals so the card list survives a refresh", async () => {
    const store = new FakeStore()
    const proposals = [
      {
        id: "p1",
        dayId: "d1",
        summary: "Add Tsuta",
        kind: "add-activities" as const,
        payload: { activities: [{ name: "Tsuta" }] },
      },
    ]
    await persistChatTurn(turn({ proposals }), store)
    const assistant = store.rows.find((r) => r.role === "assistant")!
    assert.deepEqual(assistant.proposals, proposals)
  })

  it("stores the assistant reply under the id the endpoint already told the client", async () => {
    const store = new FakeStore()
    // The `done` frame ships this id before the row is written, and the client
    // records Apply/Dismiss against it. If the row landed under a different id
    // every in-session decision would silently fail to persist.
    await persistChatTurn(turn({ assistantMessageId: "assistant-row-id" }), store)
    const assistant = store.rows.find((r) => r.role === "assistant")!
    assert.equal(assistant.id, "assistant-row-id")
    // ...and only the assistant row: the user turn keeps its own identity.
    assert.notEqual(store.rows.find((r) => r.role === "user")!.id, "assistant-row-id")
  })

  // ── The abort / partial-stream boundary ──────────────────────────────────
  // A discuss turn is step-metered and settles credits exactly once. Writing a
  // half-streamed answer would put a truncated reply in history AND ship it
  // back into the model's context on the next turn.

  it("persists NOTHING when the stream was aborted mid-way", async () => {
    const store = new FakeStore()
    const result = await persistChatTurn(
      turn({ aborted: true, assistantContent: "Try Tsu" }),
      store,
    )
    assert.equal(result.persisted, false)
    assert.equal(result.reason, "aborted")
    assert.equal(store.rows.length, 0)
  })

  it("persists nothing when the assistant produced no text and no proposals", async () => {
    const store = new FakeStore()
    const result = await persistChatTurn(turn({ assistantContent: "   \n  " }), store)
    assert.equal(result.persisted, false)
    assert.equal(result.reason, "empty")
    assert.equal(store.rows.length, 0)
  })

  it("still persists a proposal-only turn that produced no prose", async () => {
    const store = new FakeStore()
    const result = await persistChatTurn(
      turn({
        assistantContent: "",
        proposals: [
          {
            id: "p1",
            dayId: "d1",
            summary: "Add Tsuta",
            kind: "add-activities" as const,
            payload: { activities: [] },
          },
        ],
      }),
      store,
    )
    assert.equal(result.persisted, true)
    assert.equal(store.rows.length, 2)
  })

  it("persists nothing when the user turn is blank", async () => {
    const store = new FakeStore()
    const result = await persistChatTurn(turn({ userContent: "  " }), store)
    assert.equal(result.persisted, false)
    assert.equal(result.reason, "empty")
    assert.equal(store.rows.length, 0)
  })

  // Persistence runs AFTER credits are settled and after `done` ships. If it
  // threw, it would land in the endpoint's catch and risk reporting a finished
  // turn as failed, so it must swallow its own failures.
  it("never throws when the store fails — billing must not be disturbed", async () => {
    const exploding: ChatStore = {
      insertMessages: async () => {
        throw new Error("connection terminated unexpectedly")
      },
      pruneThread: async () => 0,
      listThread: async () => [],
      clearThread: async () => 0,
      setProposalState: async () => false,
      listDayVersions: async () => ({}),
    }
    const result = await persistChatTurn(turn(), exploding)
    assert.equal(result.persisted, false)
    assert.equal(result.reason, "error")
  })

  it("never throws when pruning fails after a successful insert", async () => {
    const store = new FakeStore()
    const flaky: ChatStore = {
      insertMessages: (rows) => store.insertMessages(rows),
      pruneThread: async () => {
        throw new Error("deadlock detected")
      },
      listThread: (t, u, l) => store.listThread(t, u, l),
      clearThread: (t, u) => store.clearThread(t, u),
      setProposalState: (a) => store.setProposalState(a),
      listDayVersions: (t) => store.listDayVersions(t),
    }
    const result = await persistChatTurn(turn(), flaky)
    assert.equal(result.persisted, true)
    assert.equal(store.rows.length, 2)
  })

  // ── Retention ────────────────────────────────────────────────────────────

  it("prunes the thread back to CHAT_HISTORY_LIMIT, keeping the NEWEST rows", async () => {
    const store = new FakeStore()
    for (let i = 0; i < CHAT_HISTORY_LIMIT; i++) {
      store.seed({ tripId: TRIP, userId: ALICE, role: "user", content: `old-${i}` })
    }
    await persistChatTurn(turn(), store)

    const thread = store.rows.filter((r) => r.tripId === TRIP && r.userId === ALICE)
    assert.equal(thread.length, CHAT_HISTORY_LIMIT)
    assert.ok(
      thread.some((r) => r.content === "Try Tsuta for ramen."),
      "the newest reply must survive pruning",
    )
    assert.ok(!thread.some((r) => r.content === "old-0"), "the oldest row must be the one evicted")
    assert.ok(thread.some((r) => r.content === `old-${CHAT_HISTORY_LIMIT - 1}`))
  })

  it("prunes only the writer's own thread, never a co-traveller's", async () => {
    const store = new FakeStore()
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 10; i++) {
      store.seed({ tripId: TRIP, userId: BOB, role: "user", content: `bob-${i}` })
    }
    await persistChatTurn(turn(), store)
    assert.equal(store.rows.filter((r) => r.userId === BOB).length, CHAT_HISTORY_LIMIT + 10)
  })

  it("truncates an oversized message instead of storing it unbounded", async () => {
    const store = new FakeStore()
    const huge = "x".repeat(CHAT_MESSAGE_MAX_CHARS * 3)
    await persistChatTurn(turn({ userContent: huge, assistantContent: huge }), store)
    for (const row of store.rows) {
      assert.equal(row.content.length, CHAT_MESSAGE_MAX_CHARS)
    }
  })
})

describe("loadChatHistory", () => {
  it("returns only the requesting user's own messages for that trip", async () => {
    const store = new FakeStore()
    store.seed({ tripId: TRIP, userId: ALICE, role: "user", content: "alice-secret" })
    store.seed({ tripId: TRIP, userId: BOB, role: "user", content: "bob-secret" })
    store.seed({ tripId: OTHER_TRIP, userId: ALICE, role: "user", content: "other-trip" })

    const history = await loadChatHistory(TRIP, ALICE, store)
    assert.deepEqual(
      history.map((m) => m.content),
      ["alice-secret"],
    )
  })

  it("does not leak a co-traveller's thread on a shared trip", async () => {
    const store = new FakeStore()
    store.seed({ tripId: TRIP, userId: BOB, role: "user", content: "bob asked about a surprise" })
    store.seed({ tripId: TRIP, userId: BOB, role: "assistant", content: "here is the surprise" })

    const history = await loadChatHistory(TRIP, ALICE, store)
    assert.deepEqual(history, [])
  })

  it("returns messages oldest-first so the transcript renders in order", async () => {
    const store = new FakeStore()
    store.seed({
      tripId: TRIP,
      userId: ALICE,
      role: "user",
      content: "second",
      createdAt: new Date(2_000),
    })
    store.seed({
      tripId: TRIP,
      userId: ALICE,
      role: "user",
      content: "first",
      createdAt: new Date(1_000),
    })
    const history = await loadChatHistory(TRIP, ALICE, store)
    assert.deepEqual(
      history.map((m) => m.content),
      ["first", "second"],
    )
  })

  it("caps the read at CHAT_HISTORY_LIMIT, returning the newest window", async () => {
    const store = new FakeStore()
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 25; i++) {
      store.seed({ tripId: TRIP, userId: ALICE, role: "user", content: `m-${i}` })
    }
    const history = await loadChatHistory(TRIP, ALICE, store)
    assert.equal(history.length, CHAT_HISTORY_LIMIT)
    assert.equal(history.at(-1)!.content, `m-${CHAT_HISTORY_LIMIT + 24}`)
    assert.equal(history.at(0)!.content, `m-25`)
  })
})

// ── The three-state proposal model on a restored thread ────────────────────
//
// Before this existed, `loadChatHistory` had no state to report and the page
// stamped every restored proposal "dismissed", which hid the Applied stamp and
// the Undo button along with the card. The states below are what make a
// restored transcript truthful; they are asserted by VALUE, never by presence.
//
// The second axis is supersession: a proposal is only actionable while it is
// still the last thing to have touched its day. Every case below fixes a day
// version relative to the proposal's own baseline, because "is this stale?" is
// the question that decides whether Undo is offered at all.

const DAY_1 = "d1"
const DAY_2 = "d2"
/** When the assistant produced the proposals. The `pending` baseline. */
const PROPOSED_AT = new Date(10_000)
const BEFORE_PROPOSAL = new Date(5_000)
const AFTER_PROPOSAL = new Date(20_000)

const PROPOSALS = [
  {
    id: "p-a",
    dayId: DAY_1,
    summary: "Add Tsuta",
    kind: "add-activities" as const,
    payload: { activities: [{ name: "Tsuta" }] },
  },
  {
    id: "p-b",
    dayId: DAY_1,
    summary: "Add Ichiran",
    kind: "add-activities" as const,
    payload: { activities: [{ name: "Ichiran" }] },
  },
  {
    id: "p-c",
    dayId: DAY_2,
    summary: "Reorder day 2",
    kind: "reorder-activities" as const,
    payload: { orderedActivityIds: ["a1", "a2"] },
  },
]

function seedTurnWithProposals(store: FakeStore, userId = ALICE) {
  store.seed({
    tripId: TRIP,
    userId,
    role: "assistant",
    content: "Here are three ideas.",
    proposals: PROPOSALS,
    createdAt: PROPOSED_AT,
  })
  // Untouched since the assistant spoke — the baseline every test below moves
  // away from deliberately.
  store.dayVersions[TRIP] = { [DAY_1]: BEFORE_PROPOSAL, [DAY_2]: BEFORE_PROPOSAL }
  return store.rows.at(-1)!
}

async function statesOf(store: FakeStore, userId = ALICE) {
  const history = await loadChatHistory(TRIP, userId, store)
  return history.at(-1)!.proposalStates
}

describe("loadChatHistory proposal states", () => {
  it("restores an applied proposal as applied and a dismissed one as dismissed", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    row.proposalStates = {
      "p-a": { state: "applied", dayVersion: BEFORE_PROPOSAL.toISOString() },
      "p-b": { state: "dismissed" },
    }

    const states = await statesOf(store)
    assert.equal(states["p-a"]!.state, "applied")
    assert.equal(states["p-b"]!.state, "dismissed")
  })

  it("restores a proposal that was never acted on as pending, not dismissed", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    row.proposalStates = { "p-a": { state: "applied", dayVersion: PROPOSED_AT.toISOString() } }

    // The regression: this used to come back "dismissed", so the card vanished
    // even though the user never decided anything about it.
    const states = await statesOf(store)
    assert.deepEqual(states["p-c"], { state: "pending", superseded: false })
  })

  it("reports a state for EVERY proposal on the message, so the client never defaults", async () => {
    const store = new FakeStore()
    seedTurnWithProposals(store)

    assert.deepEqual(await statesOf(store), {
      "p-a": { state: "pending", superseded: false },
      "p-b": { state: "pending", superseded: false },
      "p-c": { state: "pending", superseded: false },
    })
  })

  it("ignores stored keys that no longer match a proposal on the message", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    row.proposalStates = {
      "p-a": { state: "applied", dayVersion: BEFORE_PROPOSAL.toISOString() },
      "p-from-a-deleted-card": { state: "applied" },
    }

    assert.deepEqual(Object.keys(await statesOf(store)).toSorted(), ["p-a", "p-b", "p-c"])
  })

  it("reads an unrecognised stored value as pending rather than trusting it", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    // "applying" is a transient UI state that must never be persisted, and the
    // column is jsonb — anything could be in there.
    row.proposalStates = { "p-a": { state: "applying" }, "p-b": { state: "yes" } }

    const states = await statesOf(store)
    assert.equal(states["p-a"]!.state, "pending")
    assert.equal(states["p-b"]!.state, "pending")
  })

  it("starts a freshly persisted turn with no proposal decisions recorded", async () => {
    const store = new FakeStore()
    store.dayVersions[TRIP] = { d1: BEFORE_PROPOSAL }
    await persistChatTurn(
      turn({
        proposals: [
          {
            id: "p1",
            dayId: "d1",
            summary: "Add Tsuta",
            kind: "add-activities" as const,
            payload: { activities: [] },
          },
        ],
      }),
      store,
    )
    const message = (await loadChatHistory(TRIP, ALICE, store)).at(-1)!
    assert.equal(message.role, "assistant")
    assert.deepEqual(message.proposalStates, { p1: { state: "pending", superseded: false } })
  })
})

// ── Supersession ───────────────────────────────────────────────────────────
//
// A proposal is the tip of its day's history or it is stale. The dangerous
// direction is a stale proposal reading as fresh: Undo would restore a snapshot
// that predates later edits and silently discard them.

describe("loadChatHistory supersession", () => {
  it("leaves a pending proposal actionable while its day has not been touched", async () => {
    const store = new FakeStore()
    seedTurnWithProposals(store)

    const states = await statesOf(store)
    assert.equal(states["p-c"]!.superseded, false)
  })

  it("supersedes a pending proposal once its day is edited afterwards", async () => {
    const store = new FakeStore()
    seedTurnWithProposals(store)
    // Any writer at all — the day version is bumped by a trigger, so a
    // co-traveller's edit through a route this user never called counts, which
    // is the case an in-session-only signal would miss entirely.
    store.dayVersions[TRIP]![DAY_2] = AFTER_PROPOSAL

    const states = await statesOf(store)
    assert.deepEqual(states["p-c"], { state: "pending", superseded: true })
    // ...and only that day's proposals. Day 1 was untouched.
    assert.equal(states["p-a"]!.superseded, false)
  })

  it("does NOT supersede an apply by the day bump the apply itself caused", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    // Applying wrote activities, so the trigger moved the day version forward;
    // the watermark recorded for the apply is that exact value.
    const appliedVersion = AFTER_PROPOSAL
    store.dayVersions[TRIP]![DAY_1] = appliedVersion
    row.proposalStates = {
      "p-a": { state: "applied", dayVersion: appliedVersion.toISOString() },
    }

    const states = await statesOf(store)
    assert.deepEqual(states["p-a"], { state: "applied", superseded: false })
  })

  it("supersedes an applied proposal once the day changes again after it", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    row.proposalStates = {
      "p-a": { state: "applied", dayVersion: AFTER_PROPOSAL.toISOString() },
    }
    store.dayVersions[TRIP]![DAY_1] = new Date(AFTER_PROPOSAL.getTime() + 1)

    const states = await statesOf(store)
    assert.deepEqual(states["p-a"], { state: "applied", superseded: true })
  })

  it("supersedes an applied proposal that carries no watermark", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    // Rows written before the watermark existed. Undo cannot be proven safe, so
    // it is refused rather than offered on a guess.
    row.proposalStates = { "p-a": { state: "applied" } }

    const states = await statesOf(store)
    assert.deepEqual(states["p-a"], { state: "applied", superseded: true })
  })

  it("supersedes every proposal whose day no longer exists", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    row.proposalStates = {
      "p-a": { state: "applied", dayVersion: BEFORE_PROPOSAL.toISOString() },
    }
    // The trip's dates changed and day 1 was dropped. Undo has no target and
    // Apply has nothing to apply to.
    delete store.dayVersions[TRIP]![DAY_1]

    const states = await statesOf(store)
    assert.equal(states["p-a"]!.superseded, true)
    assert.deepEqual(states["p-b"], { state: "pending", superseded: true })
  })

  it("never marks a dismissed proposal superseded — the card is closed either way", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    row.proposalStates = { "p-b": { state: "dismissed" } }
    store.dayVersions[TRIP]![DAY_1] = AFTER_PROPOSAL

    const states = await statesOf(store)
    assert.deepEqual(states["p-b"], { state: "dismissed", superseded: false })
  })

  it("reads day versions for THIS trip only", async () => {
    const store = new FakeStore()
    seedTurnWithProposals(store)
    // Another trip that happens to have a day of the same id, edited long after.
    store.dayVersions[OTHER_TRIP] = { [DAY_2]: AFTER_PROPOSAL }

    const states = await statesOf(store)
    assert.equal(states["p-c"]!.superseded, false)
  })
})

describe("recordProposalState", () => {
  it("records applied with its watermark, and the next load reads it back undoable", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    const appliedVersion = AFTER_PROPOSAL
    store.dayVersions[TRIP]![DAY_2] = appliedVersion

    const result = await recordProposalState(
      {
        tripId: TRIP,
        userId: ALICE,
        messageId: row.id,
        proposalId: "p-c",
        state: "applied",
        dayVersion: appliedVersion,
      },
      store,
    )
    assert.deepEqual(result, { recorded: true })

    const states = await statesOf(store)
    assert.deepEqual(states["p-c"], { state: "applied", superseded: false })
    // The siblings must be untouched, not overwritten by the merge.
    assert.deepEqual(states["p-a"], { state: "pending", superseded: false })
    assert.deepEqual(states["p-b"], { state: "pending", superseded: false })

    // ...and one later edit to that day takes the Undo away again.
    store.dayVersions[TRIP]![DAY_2] = new Date(appliedVersion.getTime() + 1)
    assert.deepEqual((await statesOf(store))["p-c"], { state: "applied", superseded: true })
  })

  it("records dismissed", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)
    await recordProposalState(
      { tripId: TRIP, userId: ALICE, messageId: row.id, proposalId: "p-b", state: "dismissed" },
      store,
    )
    assert.deepEqual((await statesOf(store))["p-b"], { state: "dismissed", superseded: false })
  })

  it("refuses to write a co-traveller's message and leaves their state alone", async () => {
    const store = new FakeStore()
    const bobsRow = seedTurnWithProposals(store, BOB)

    const result = await recordProposalState(
      { tripId: TRIP, userId: ALICE, messageId: bobsRow.id, proposalId: "p-c", state: "applied" },
      store,
    )
    assert.deepEqual(result, { recorded: false, reason: "not-found" })
    assert.deepEqual(bobsRow.proposalStates, {})
  })

  it("refuses a message id from another trip", async () => {
    const store = new FakeStore()
    store.seed({
      tripId: OTHER_TRIP,
      userId: ALICE,
      role: "assistant",
      content: "elsewhere",
      proposals: PROPOSALS,
    })
    const elsewhere = store.rows.at(-1)!

    const result = await recordProposalState(
      { tripId: TRIP, userId: ALICE, messageId: elsewhere.id, proposalId: "p-c", state: "applied" },
      store,
    )
    assert.deepEqual(result, { recorded: false, reason: "not-found" })
    assert.deepEqual(elsewhere.proposalStates, {})
  })

  it("refuses a proposal id that is not on that message, so the column cannot be stuffed", async () => {
    const store = new FakeStore()
    const row = seedTurnWithProposals(store)

    const result = await recordProposalState(
      { tripId: TRIP, userId: ALICE, messageId: row.id, proposalId: "p-forged", state: "applied" },
      store,
    )
    assert.deepEqual(result, { recorded: false, reason: "not-found" })
    assert.deepEqual(row.proposalStates, {})
  })

  it("never throws when the store fails — an apply must not be reported as failed", async () => {
    const exploding: ChatStore = {
      insertMessages: async () => {},
      pruneThread: async () => 0,
      listThread: async () => [],
      clearThread: async () => 0,
      listDayVersions: async () => ({}),
      setProposalState: async () => {
        throw new Error("connection terminated unexpectedly")
      },
    }
    const result = await recordProposalState(
      { tripId: TRIP, userId: ALICE, messageId: "m1", proposalId: "p1", state: "applied" },
      exploding,
    )
    assert.deepEqual(result, { recorded: false, reason: "error" })
  })
})
describe("clearChatThread", () => {
  it("deletes only the requesting user's thread on that trip", async () => {
    const store = new FakeStore()
    store.seed({ tripId: TRIP, userId: ALICE, role: "user", content: "alice" })
    store.seed({ tripId: TRIP, userId: BOB, role: "user", content: "bob" })
    store.seed({ tripId: OTHER_TRIP, userId: ALICE, role: "user", content: "alice-elsewhere" })

    const deleted = await clearChatThread(TRIP, ALICE, store)
    assert.equal(deleted, 1)
    assert.deepEqual(store.rows.map((r) => r.content).toSorted(), ["alice-elsewhere", "bob"])
  })
})
