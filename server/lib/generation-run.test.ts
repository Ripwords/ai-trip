import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  STALE_CLAIM_MS,
  beginRunDay,
  endRunDay,
  isClaimable,
  remainingRunDays,
  startOrResumeRun,
  summarizeRun,
  type GenerationRunRecord,
  type GenerationRunStore,
  type RunDayRecord,
  type TripDaySnapshot,
} from "./generation-run"
import type { TripOutline } from "./trip-outline"

// ── Fakes ────────────────────────────────────────────────────────────
//
// The store fake is deliberately faithful rather than convenient: `claimDay`
// re-reads its own state and applies the SAME status/staleness predicate the
// SQL WHERE clause applies, so a claim that the database would reject is
// rejected here too. A fake that always said "claimed" would let a
// double-charge bug pass every test in this file.

class FakeStore implements GenerationRunStore {
  runs: GenerationRunRecord[] = []
  private seq = 0

  async findActiveRun(tripId: string): Promise<GenerationRunRecord | null> {
    return this.runs.find((r) => r.tripId === tripId && r.status === "running") ?? null
  }

  async findRun(runId: string): Promise<GenerationRunRecord | null> {
    return this.runs.find((r) => r.id === runId) ?? null
  }

  async createRun(input: {
    tripId: string
    userId: string
    mode: "outline" | "generic"
    outline: TripOutline | null
    creditsCharged: number
    days: { dayId: string; dayNumber: number }[]
  }): Promise<GenerationRunRecord> {
    if (this.runs.some((r) => r.tripId === input.tripId && r.status === "running")) {
      // Mirrors the partial unique index on (trip_id) WHERE status = 'running'.
      throw new Error("a run is already active for this trip")
    }
    const run: GenerationRunRecord = {
      id: `run-${++this.seq}`,
      tripId: input.tripId,
      userId: input.userId,
      status: "running",
      mode: input.mode,
      outline: input.outline,
      creditsCharged: input.creditsCharged,
      days: input.days.map((d) => ({
        dayId: d.dayId,
        dayNumber: d.dayNumber,
        status: "pending" as const,
        attempts: 0,
        lastError: null,
        claimedAt: null,
      })),
    }
    this.runs.push(run)
    return run
  }

  async addRunDays(runId: string, days: { dayId: string; dayNumber: number }[]): Promise<void> {
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return
    for (const d of days) {
      // Mirrors ON CONFLICT DO NOTHING on the (run_id, day_id) unique index.
      if (run.days.some((existing) => existing.dayId === d.dayId)) continue
      run.days.push({
        dayId: d.dayId,
        dayNumber: d.dayNumber,
        status: "pending",
        attempts: 0,
        lastError: null,
        claimedAt: null,
      })
    }
  }

  async claimDay(runId: string, dayId: string, now: Date, staleAfterMs: number): Promise<boolean> {
    const run = this.runs.find((r) => r.id === runId && r.status === "running")
    const day = run?.days.find((d) => d.dayId === dayId)
    if (!run || !day) return false
    if (!isClaimable(day, now, staleAfterMs)) return false
    day.status = "in_progress"
    day.claimedAt = now
    day.attempts += 1
    run.creditsCharged += 1
    return true
  }

  async markDay(
    runId: string,
    dayId: string,
    status: "succeeded" | "failed",
    error: string | null,
  ): Promise<void> {
    const day = this.runs.find((r) => r.id === runId)?.days.find((d) => d.dayId === dayId)
    if (!day) return
    day.status = status
    day.lastError = error
    day.claimedAt = null
  }

  async releaseDay(runId: string, dayId: string): Promise<void> {
    const run = this.runs.find((r) => r.id === runId)
    if (!run?.days.some((d) => d.dayId === dayId)) return
    run.creditsCharged = Math.max(0, run.creditsCharged - 1)
  }

  async finishRun(runId: string, status: "completed" | "cancelled"): Promise<void> {
    const run = this.runs.find((r) => r.id === runId)
    if (run) run.status = status
  }
}

/** Counts every credit movement so a double-charge is visible as a number. */
class FakeLedger {
  consumed = 0
  refunded = 0
  get net(): number {
    return this.consumed - this.refunded
  }
  consume = async (): Promise<void> => {
    this.consumed += 1
  }
  refund = async (): Promise<void> => {
    this.refunded += 1
  }
}

function snapshotOf(counts: Record<string, number>): TripDaySnapshot[] {
  return Object.entries(counts).map(([dayId, activityCount], i) => ({
    dayId,
    dayNumber: i + 1,
    activityCount,
  }))
}

const outline: TripOutline = {
  days: [
    {
      dayId: "d1",
      dayNumber: 1,
      theme: "Arrival",
      focusArea: "Gion",
      mustInclude: [],
      guidance: "Take it easy.",
    },
  ],
  avoidRepeats: ["Fushimi Inari"],
}

function dayRecord(over: Partial<RunDayRecord> = {}): RunDayRecord {
  return {
    dayId: "d1",
    dayNumber: 1,
    status: "pending",
    attempts: 0,
    lastError: null,
    claimedAt: null,
    ...over,
  }
}

const NOW = new Date("2026-08-05T10:00:00Z")

// ── isClaimable ──────────────────────────────────────────────────────

describe("isClaimable", () => {
  it("claims pending and failed days", () => {
    assert.equal(isClaimable(dayRecord({ status: "pending" }), NOW, STALE_CLAIM_MS), true)
    assert.equal(isClaimable(dayRecord({ status: "failed" }), NOW, STALE_CLAIM_MS), true)
  })

  it("never re-claims a succeeded day", () => {
    assert.equal(isClaimable(dayRecord({ status: "succeeded" }), NOW, STALE_CLAIM_MS), false)
  })

  it("refuses a fresh in-progress claim but reclaims a stale one", () => {
    const fresh = dayRecord({
      status: "in_progress",
      claimedAt: new Date(NOW.getTime() - STALE_CLAIM_MS + 1000),
    })
    const stale = dayRecord({
      status: "in_progress",
      claimedAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1000),
    })
    assert.equal(isClaimable(fresh, NOW, STALE_CLAIM_MS), false)
    assert.equal(isClaimable(stale, NOW, STALE_CLAIM_MS), true)
  })

  it("treats an in-progress day with no claim timestamp as stale", () => {
    assert.equal(
      isClaimable(dayRecord({ status: "in_progress", claimedAt: null }), NOW, STALE_CLAIM_MS),
      true,
    )
  })
})

// ── remainingRunDays ─────────────────────────────────────────────────

describe("remainingRunDays", () => {
  const store = new FakeStore()

  async function runWith(days: RunDayRecord[]): Promise<GenerationRunRecord> {
    const run = await store.createRun({
      tripId: `t-${Math.random()}`,
      userId: "u1",
      mode: "outline",
      outline,
      creditsCharged: 1,
      days: days.map((d) => ({ dayId: d.dayId, dayNumber: d.dayNumber })),
    })
    run.days = days
    return run
  }

  it("skips days that already have activities, even if the run says pending", async () => {
    const run = await runWith([
      dayRecord({ dayId: "d1", dayNumber: 1, status: "pending" }),
      dayRecord({ dayId: "d2", dayNumber: 2, status: "pending" }),
    ])
    // d1 was filled in another tab / by hand after the run started.
    const remaining = remainingRunDays(run, snapshotOf({ d1: 3, d2: 0 }), NOW)
    assert.deepEqual(
      remaining.map((d) => d.dayId),
      ["d2"],
    )
  })

  it("drops days that no longer exist on the trip", async () => {
    const run = await runWith([
      dayRecord({ dayId: "d1", dayNumber: 1 }),
      dayRecord({ dayId: "gone", dayNumber: 2 }),
    ])
    const remaining = remainingRunDays(run, snapshotOf({ d1: 0 }), NOW)
    assert.deepEqual(
      remaining.map((d) => d.dayId),
      ["d1"],
    )
  })

  it("returns failed days so they can be retried, in day order", async () => {
    const run = await runWith([
      dayRecord({ dayId: "d3", dayNumber: 3, status: "failed", lastError: "502" }),
      dayRecord({ dayId: "d1", dayNumber: 1, status: "succeeded" }),
      dayRecord({ dayId: "d2", dayNumber: 2, status: "pending" }),
    ])
    const remaining = remainingRunDays(run, snapshotOf({ d1: 4, d2: 0, d3: 0 }), NOW)
    assert.deepEqual(
      remaining.map((d) => d.dayNumber),
      [2, 3],
    )
  })

  it("excludes a day another tab is generating right now", async () => {
    const run = await runWith([
      dayRecord({ dayId: "d1", dayNumber: 1, status: "in_progress", claimedAt: NOW }),
      dayRecord({ dayId: "d2", dayNumber: 2 }),
    ])
    assert.deepEqual(
      remainingRunDays(run, snapshotOf({ d1: 0, d2: 0 }), NOW).map((d) => d.dayId),
      ["d2"],
    )
  })
})

// ── summarizeRun ─────────────────────────────────────────────────────

describe("summarizeRun", () => {
  it("counts generated days from the database, not from run bookkeeping", async () => {
    const store = new FakeStore()
    const run = await store.createRun({
      tripId: "t1",
      userId: "u1",
      mode: "outline",
      outline,
      creditsCharged: 3,
      days: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
        { dayId: "d3", dayNumber: 3 },
      ],
    })
    run.days[0]!.status = "succeeded"
    run.days[1]!.status = "failed"
    // d3 is still pending in the run but the traveler filled it by hand.
    const summary = summarizeRun(run, snapshotOf({ d1: 5, d2: 0, d3: 2 }), NOW)
    assert.deepEqual(summary, {
      total: 3,
      generated: 2,
      failed: 1,
      remaining: 1,
      creditsCharged: 3,
    })
  })
})

// ── startOrResumeRun ─────────────────────────────────────────────────

describe("startOrResumeRun", () => {
  it("charges exactly one credit for the outline on a fresh run", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const res = await startOrResumeRun({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
      ],
      snapshot: snapshotOf({ d1: 0, d2: 0 }),
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    })
    assert.equal(res.resumed, false)
    assert.equal(res.run.mode, "outline")
    assert.deepEqual(res.run.outline, outline)
    assert.equal(ledger.consumed, 1)
    assert.equal(ledger.refunded, 0)
    assert.equal(res.run.creditsCharged, 1)
  })

  it("refunds exactly once and degrades to generic when the outline throws", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const res = await startOrResumeRun({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
      now: NOW,
      buildOutline: async () => {
        throw new Error("gemini exploded")
      },
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    })
    assert.equal(res.run.mode, "generic")
    assert.equal(res.run.outline, null)
    assert.equal(ledger.consumed, 1)
    assert.equal(ledger.refunded, 1)
    assert.equal(ledger.net, 0)
    assert.equal(res.run.creditsCharged, 0)
  })

  it("refunds an outline that came back with zero usable days", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const res = await startOrResumeRun({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
      now: NOW,
      buildOutline: async () => ({ days: [], avoidRepeats: [] }),
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    })
    assert.equal(res.run.mode, "generic")
    assert.equal(ledger.net, 0)
  })

  it("skipOutline creates a generic run without touching the credit ledger", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    let outlineCalls = 0
    const res = await startOrResumeRun({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
      now: NOW,
      buildOutline: async () => {
        outlineCalls += 1
        return outline
      },
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
      skipOutline: true,
    })
    assert.equal(outlineCalls, 0)
    assert.equal(ledger.consumed, 0, "a traveler short on credits must not pay for a plan")
    assert.equal(ledger.refunded, 0)
    assert.equal(res.run.mode, "generic")
    assert.equal(res.run.outline, null)
    assert.equal(res.run.creditsCharged, 0)
    assert.deepEqual(
      res.remaining.map((d) => d.dayId),
      ["d1"],
    )
  })

  it("resuming an active run charges nothing and reuses the stored outline", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const args = {
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
      ],
      snapshot: snapshotOf({ d1: 0, d2: 0 }),
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    }
    const first = await startOrResumeRun(args)
    let outlineCalls = 0
    const second = await startOrResumeRun({
      ...args,
      buildOutline: async () => {
        outlineCalls += 1
        return outline
      },
    })
    assert.equal(second.resumed, true)
    assert.equal(second.run.id, first.run.id)
    assert.equal(outlineCalls, 0, "resume must not call the outline model again")
    assert.equal(ledger.consumed, 1, "resume must not charge a second outline credit")
    assert.deepEqual(second.run.outline, outline)
  })

  it("adopts days added to the trip after the run started, without a new outline credit", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const base = {
      store,
      tripId: "t1",
      userId: "u1",
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    }
    const first = await startOrResumeRun({
      ...base,
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
    })

    // The traveler extends the trip by a day mid-run.
    const second = await startOrResumeRun({
      ...base,
      emptyDays: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
      ],
      snapshot: snapshotOf({ d1: 0, d2: 0 }),
    })
    assert.equal(second.run.id, first.run.id)
    assert.equal(second.resumed, true)
    assert.equal(ledger.consumed, 1, "adopting a day must not buy a second outline")
    assert.deepEqual(
      second.remaining.map((d) => d.dayId),
      ["d1", "d2"],
    )

    // Adopting is idempotent — a third call must not duplicate the day.
    const third = await startOrResumeRun({
      ...base,
      emptyDays: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
      ],
      snapshot: snapshotOf({ d1: 0, d2: 0 }),
    })
    assert.equal(third.run.days.length, 2)
  })

  it("does not re-adopt a day the run already finished", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const base = {
      store,
      tripId: "t1",
      userId: "u1",
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
      emptyDays: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
      ],
    }
    const first = await startOrResumeRun({ ...base, snapshot: snapshotOf({ d1: 0, d2: 0 }) })
    await store.markDay(first.run.id, "d1", "succeeded", null)
    // The traveler wiped day 1's activities by hand, so it looks empty again.
    const second = await startOrResumeRun({ ...base, snapshot: snapshotOf({ d1: 0, d2: 0 }) })
    assert.equal(second.run.days.length, 2, "no duplicate row for d1")
    assert.deepEqual(
      second.remaining.map((d) => d.dayId),
      ["d2"],
      "a day this run already generated stays done — the run does not redo it",
    )
  })

  it("starts a genuinely new run, paying for its own outline, once the old one is cancelled", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const base = {
      store,
      tripId: "t1",
      userId: "u1",
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    }
    const first = await startOrResumeRun({
      ...base,
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
    })
    // The traveler abandoned the plan rather than finishing it.
    await store.finishRun(first.run.id, "cancelled")

    const second = await startOrResumeRun({
      ...base,
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
    })
    assert.notEqual(second.run.id, first.run.id)
    assert.equal(second.resumed, false)
    assert.equal(ledger.consumed, 2, "a genuinely new run pays for its own outline")
  })

  it("retires a run whose days are all done rather than resuming it", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const base = {
      store,
      tripId: "t1",
      userId: "u1",
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    }
    const first = await startOrResumeRun({
      ...base,
      emptyDays: [{ dayId: "d1", dayNumber: 1 }],
      snapshot: snapshotOf({ d1: 0 }),
    })
    await store.markDay(first.run.id, "d1", "succeeded", null)

    const second = await startOrResumeRun({
      ...base,
      emptyDays: [{ dayId: "d2", dayNumber: 2 }],
      snapshot: [
        { dayId: "d1", dayNumber: 1, activityCount: 4 },
        { dayId: "d2", dayNumber: 2, activityCount: 0 },
      ],
    })
    // d2 is adopted into the live run — free, and it keeps the trip's one
    // active-run slot meaningful.
    assert.equal(second.run.id, first.run.id)
    assert.equal(ledger.consumed, 1)
    assert.deepEqual(
      second.remaining.map((d) => d.dayId),
      ["d2"],
    )
  })

  it("refuses to bill for a run with no days to generate", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    await assert.rejects(
      () =>
        startOrResumeRun({
          store,
          tripId: "t1",
          userId: "u1",
          emptyDays: [],
          snapshot: snapshotOf({ d1: 3 }),
          now: NOW,
          buildOutline: async () => outline,
          consumeCredit: ledger.consume,
          refundCredit: ledger.refund,
        }),
      /no days/i,
    )
    assert.equal(ledger.consumed, 0, "an empty run must never reach the credit ledger")
    assert.equal(store.runs.length, 0)
  })
})

// ── beginRunDay / endRunDay ──────────────────────────────────────────

describe("beginRunDay", () => {
  async function freshRun(store: FakeStore): Promise<GenerationRunRecord> {
    return store.createRun({
      tripId: "t1",
      userId: "u1",
      mode: "outline",
      outline,
      creditsCharged: 1,
      days: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
      ],
    })
  }

  it("claims a pending day", async () => {
    const store = new FakeStore()
    const run = await freshRun(store)
    assert.equal(
      await beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW }),
      "claimed",
    )
  })

  it("reports already-done for a succeeded day so the caller skips the charge", async () => {
    const store = new FakeStore()
    const run = await freshRun(store)
    await store.markDay(run.id, "d1", "succeeded", null)
    assert.equal(
      await beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW }),
      "already-done",
    )
  })

  it("lets only one of two concurrent claims through", async () => {
    const store = new FakeStore()
    const run = await freshRun(store)
    const both = await Promise.all([
      beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW }),
      beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW }),
    ])
    assert.deepEqual(both.toSorted(), ["claimed", "in-flight"])
  })

  it("refuses a run belonging to another user", async () => {
    const store = new FakeStore()
    const run = await freshRun(store)
    assert.equal(
      await beginRunDay(store, { runId: run.id, dayId: "d1", userId: "intruder", now: NOW }),
      "not-found",
    )
  })

  it("refuses a day that is not part of the run", async () => {
    const store = new FakeStore()
    const run = await freshRun(store)
    assert.equal(
      await beginRunDay(store, { runId: run.id, dayId: "d9", userId: "u1", now: NOW }),
      "not-found",
    )
  })

  it("refuses a finished run", async () => {
    const store = new FakeStore()
    const run = await freshRun(store)
    await store.finishRun(run.id, "cancelled")
    assert.equal(
      await beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW }),
      "not-found",
    )
  })
})

describe("endRunDay", () => {
  it("records the failure message and leaves the day retryable", async () => {
    const store = new FakeStore()
    const run = await store.createRun({
      tripId: "t1",
      userId: "u1",
      mode: "generic",
      outline: null,
      creditsCharged: 0,
      days: [{ dayId: "d1", dayNumber: 1 }],
    })
    await beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW })
    await endRunDay(store, { runId: run.id, dayId: "d1", ok: false, error: "AI unavailable" })
    const after = await store.findRun(run.id)
    assert.equal(after?.days[0]?.status, "failed")
    assert.equal(after?.days[0]?.lastError, "AI unavailable")
    assert.deepEqual(
      remainingRunDays(after!, snapshotOf({ d1: 0 }), NOW).map((d) => d.dayId),
      ["d1"],
    )
  })

  it("refunds the day credit when the work never started", async () => {
    const store = new FakeStore()
    const run = await store.createRun({
      tripId: "t1",
      userId: "u1",
      mode: "generic",
      outline: null,
      creditsCharged: 0,
      days: [{ dayId: "d1", dayNumber: 1 }],
    })
    await beginRunDay(store, { runId: run.id, dayId: "d1", userId: "u1", now: NOW })
    assert.equal((await store.findRun(run.id))?.creditsCharged, 1)
    await endRunDay(store, { runId: run.id, dayId: "d1", ok: false, error: "x", refunded: true })
    const after = await store.findRun(run.id)
    assert.equal(after?.creditsCharged, 0, "a refunded day must not stay on the run's tally")
    assert.equal(after?.days[0]?.status, "failed")
  })
})

// ── The core deliverable: interrupt, resume, no double charge ────────

describe("resuming an interrupted full-trip generation", () => {
  /**
   * Drives the exact sequence the endpoints drive: start a run, then per day
   * claim → charge → generate → mark. The "crash" is modelled the way a closed
   * tab really behaves — the day is claimed and charged, then nothing else
   * happens, so the run row is left with a dangling `in_progress`.
   */
  it("charges 1 + N total across an interrupt and generates every day exactly once", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const activityCounts: Record<string, number> = { d1: 0, d2: 0, d3: 0, d4: 0, d5: 0 }
    const generated: string[] = []

    const snapshot = (): TripDaySnapshot[] =>
      Object.entries(activityCounts).map(([dayId, activityCount], i) => ({
        dayId,
        dayNumber: i + 1,
        activityCount,
      }))
    const emptyDays = (): { dayId: string; dayNumber: number }[] =>
      snapshot()
        .filter((d) => d.activityCount === 0)
        .map((d) => ({ dayId: d.dayId, dayNumber: d.dayNumber }))

    /** Stands in for POST /days/:id/ai with a runId. */
    async function generateDay(runId: string, dayId: string, now: Date): Promise<boolean> {
      const state = await beginRunDay(store, { runId, dayId, userId: "u1", now })
      if (state !== "claimed") return false
      await ledger.consume() // tryConsumeAiCredit, after the claim
      generated.push(dayId)
      activityCounts[dayId] = 3
      await endRunDay(store, { runId, dayId, ok: true })
      return true
    }

    const startArgs = () => ({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: emptyDays(),
      snapshot: snapshot(),
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    })

    // ── First attempt: outline + 3 of 5 days, then the tab dies mid-day-4.
    const first = await startOrResumeRun(startArgs())
    assert.equal(ledger.consumed, 1)
    assert.deepEqual(
      first.remaining.map((d) => d.dayId),
      ["d1", "d2", "d3", "d4", "d5"],
    )

    for (const dayId of ["d1", "d2", "d3"]) {
      assert.equal(await generateDay(first.run.id, dayId, NOW), true)
    }
    // Day 4 is claimed and charged, then the process disappears.
    assert.equal(
      await beginRunDay(store, { runId: first.run.id, dayId: "d4", userId: "u1", now: NOW }),
      "claimed",
    )
    await ledger.consume()
    assert.equal(ledger.consumed, 5, "1 outline + 4 day credits so far")

    // ── Resume immediately: d4's claim is still fresh, so it is left alone.
    const soon = new Date(NOW.getTime() + 1000)
    const immediate = await startOrResumeRun({ ...startArgs(), now: soon })
    assert.equal(immediate.resumed, true)
    assert.equal(immediate.run.id, first.run.id)
    assert.equal(ledger.consumed, 5, "resuming must not re-charge the outline")
    assert.deepEqual(
      immediate.remaining.map((d) => d.dayId),
      ["d5"],
      "days already generated must never be offered again",
    )

    // ── Resume after the stale window: d4's dangling claim is reclaimable.
    const later = new Date(NOW.getTime() + STALE_CLAIM_MS + 1000)
    const resumed = await startOrResumeRun({ ...startArgs(), now: later })
    assert.equal(resumed.resumed, true)
    assert.equal(resumed.run.id, first.run.id)
    assert.deepEqual(
      resumed.remaining.map((d) => d.dayId),
      ["d4", "d5"],
    )

    for (const day of resumed.remaining) {
      assert.equal(await generateDay(resumed.run.id, day.dayId, later), true)
    }

    // ── The two assertions this whole feature exists for.
    assert.deepEqual(
      generated,
      ["d1", "d2", "d3", "d4", "d5"],
      "every day generated exactly once, in day order",
    )
    // 1 outline + 5 days + 1 for the day whose process died after charging.
    //
    // That stranded credit is NOT recovered on purpose. The claim is advisory
    // state, so "reclaim without charging" would hand out an unlimited number
    // of real AI calls per credit: claim, abort the request, wait out the stale
    // window, reclaim free, repeat. A hard crash mid-day costs its credit here
    // exactly as it does for any other interrupted AI request in this codebase.
    //
    // The win is everything else: re-running the flow from scratch would have
    // charged 1 outline + 5 days = 6 MORE credits (11 total) and regenerated
    // days that were already done.
    assert.equal(ledger.consumed, 7)
    assert.equal(ledger.refunded, 0)
    assert.deepEqual(activityCounts, { d1: 3, d2: 3, d3: 3, d4: 3, d5: 3 })

    // The run is exhausted; the next start is a genuinely new run.
    const summary = summarizeRun((await store.findRun(first.run.id))!, snapshot(), later)
    assert.deepEqual(summary, {
      total: 5,
      generated: 5,
      failed: 0,
      remaining: 0,
      creditsCharged: 7,
    })
  })

  it("retrying failed days re-charges only the failures", async () => {
    const store = new FakeStore()
    const ledger = new FakeLedger()
    const activityCounts: Record<string, number> = { d1: 0, d2: 0, d3: 0 }
    const attempts: string[] = []
    let failNext = new Set(["d2"])

    const snapshot = (): TripDaySnapshot[] =>
      Object.entries(activityCounts).map(([dayId, activityCount], i) => ({
        dayId,
        dayNumber: i + 1,
        activityCount,
      }))

    async function generateDay(runId: string, dayId: string, now: Date): Promise<void> {
      const state = await beginRunDay(store, { runId, dayId, userId: "u1", now })
      if (state !== "claimed") return
      await ledger.consume()
      attempts.push(dayId)
      if (failNext.has(dayId)) {
        // The AI call failed after the credit was spent and no work committed:
        // ai.post.ts refunds, so the run tally must be reversed too.
        await ledger.refund()
        await endRunDay(store, { runId, dayId, ok: false, error: "502", refunded: true })
        return
      }
      activityCounts[dayId] = 2
      await endRunDay(store, { runId, dayId, ok: true })
    }

    const start = await startOrResumeRun({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [
        { dayId: "d1", dayNumber: 1 },
        { dayId: "d2", dayNumber: 2 },
        { dayId: "d3", dayNumber: 3 },
      ],
      snapshot: snapshot(),
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    })
    for (const day of start.remaining) await generateDay(start.run.id, day.dayId, NOW)
    assert.deepEqual(attempts, ["d1", "d2", "d3"])
    assert.equal(ledger.net, 3, "1 outline + 2 kept days; the failed day was refunded")

    // Retry: only the failure comes back.
    failNext = new Set()
    const retry = await startOrResumeRun({
      store,
      tripId: "t1",
      userId: "u1",
      emptyDays: [{ dayId: "d2", dayNumber: 2 }],
      snapshot: snapshot(),
      now: NOW,
      buildOutline: async () => outline,
      consumeCredit: ledger.consume,
      refundCredit: ledger.refund,
    })
    assert.equal(retry.resumed, true)
    assert.deepEqual(
      retry.remaining.map((d) => d.dayId),
      ["d2"],
    )
    for (const day of retry.remaining) await generateDay(retry.run.id, day.dayId, NOW)
    assert.deepEqual(attempts, ["d1", "d2", "d3", "d2"])
    assert.equal(ledger.net, 4, "the retry costs exactly one credit, and no new outline")
    assert.deepEqual(activityCounts, { d1: 2, d2: 2, d3: 2 })
  })
})
