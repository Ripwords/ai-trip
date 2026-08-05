;(
  globalThis as { createError?: (input: { statusCode?: number; message?: string }) => Error }
).createError = (input) => Object.assign(new Error(input.message ?? ""), input)
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db"

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ChatStore, NewChatRow, StoredChatMessage } from "./trip-chat"

const {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_CHARS,
  clearChatThread,
  loadChatHistory,
  persistChatTurn,
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
  private seq = 0

  seed(row: Partial<Row> & { tripId: string; userId: string; role: "user" | "assistant" }) {
    this.rows.push({
      id: `seed-${this.seq}`,
      content: row.content ?? "seeded",
      toolCallSummary: row.toolCallSummary ?? [],
      proposals: row.proposals ?? [],
      createdAt: row.createdAt ?? new Date(1_000 + this.seq),
      ...row,
    } as Row)
    this.seq++
  }

  async insertMessages(rows: NewChatRow[]): Promise<void> {
    for (const r of rows) {
      // Keeps the caller-supplied createdAt: Postgres' now() is
      // transaction-stable, so the app assigns them and ordering depends on it.
      this.rows.push({ ...r, id: `ins-${this.seq}` })
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
