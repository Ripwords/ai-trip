/**
 * Integration test for the REAL Postgres store.
 *
 * `generation-run.test.ts` exercises the run logic against a hand-written fake.
 * A fake can only prove the logic is right if its `claimDay` rejects exactly
 * what the SQL rejects — so this file checks the SQL itself: the conditional
 * claim UPDATE, the staleness window, the partial unique index that allows one
 * active run per trip, and the activity-count snapshot query.
 *
 * Opt-in because the rest of the suite is pure and runs without a database:
 *
 *   GENERATION_RUN_DB_TEST=1 bun test server/lib/generation-run-store.db.test.ts
 *
 * Point DATABASE_URL at the LOCAL docker Postgres. It creates and deletes its
 * own trip; never run it against a production database.
 */

import assert from "node:assert/strict"
import { describe, it, before, after } from "node:test"

const enabled = process.env.GENERATION_RUN_DB_TEST === "1"

describe("generationRunStore (postgres)", { skip: !enabled }, async () => {
  if (!enabled) return

  const { db } = await import("../db")
  const { trips, itineraryDays, activities, user, tripGenerationRuns } =
    await import("../db/schema")
  const { eq } = await import("drizzle-orm")
  const { generationRunStore, getTripDaySnapshot } = await import("./generation-run-store")
  const { STALE_CLAIM_MS } = await import("./generation-run")

  const userId = `gen-run-test-${crypto.randomUUID()}`
  let tripId = ""
  const dayIds: string[] = []

  before(async () => {
    await db.insert(user).values({
      id: userId,
      name: "Generation Run Test",
      email: `${userId}@example.test`,
      emailVerified: false,
    })
    const [trip] = await db
      .insert(trips)
      .values({
        userId,
        destination: "Kyoto, Japan",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      })
      .returning()
    tripId = trip!.id
    const days = await db
      .insert(itineraryDays)
      .values([
        { tripId, dayNumber: 1, date: "2026-09-01" },
        { tripId, dayNumber: 2, date: "2026-09-02" },
        { tripId, dayNumber: 3, date: "2026-09-03" },
      ])
      .returning()
    dayIds.push(...days.toSorted((a, b) => a.dayNumber - b.dayNumber).map((d) => d.id))
  })

  after(async () => {
    if (tripId) await db.delete(trips).where(eq(trips.id, tripId))
    await db.delete(user).where(eq(user.id, userId))
  })

  /** Each test owns the trip's single active-run slot. */
  async function resetRuns(): Promise<void> {
    await db.delete(tripGenerationRuns).where(eq(tripGenerationRuns.tripId, tripId))
  }

  /** Postgres surfaces the violated index in the error chain, not the message. */
  function violatesActiveRunIndex(e: unknown): boolean {
    for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
      if (
        typeof cur === "object" &&
        "constraint" in cur &&
        cur.constraint === "idx_trip_generation_runs_active"
      ) {
        return true
      }
      cur = typeof cur === "object" && "cause" in cur ? cur.cause : null
    }
    return false
  }

  it("counts activities per day, including days with none", async () => {
    await db.insert(activities).values({
      itineraryDayId: dayIds[0]!,
      name: "Fushimi Inari",
      type: "attraction",
      sortOrder: 0,
    })
    const snapshot = await getTripDaySnapshot(tripId)
    assert.deepEqual(
      snapshot.map((d) => [d.dayNumber, d.activityCount]),
      [
        [1, 1],
        [2, 0],
        [3, 0],
      ],
    )
    await db.delete(activities).where(eq(activities.itineraryDayId, dayIds[0]!))
  })

  it("allows only one running run per trip", async () => {
    await resetRuns()
    const run = await generationRunStore.createRun({
      tripId,
      userId,
      mode: "generic",
      outline: null,
      creditsCharged: 1,
      days: dayIds.map((dayId, i) => ({ dayId, dayNumber: i + 1 })),
    })
    let rejection: unknown
    try {
      await generationRunStore.createRun({
        tripId,
        userId,
        mode: "generic",
        outline: null,
        creditsCharged: 1,
        days: [{ dayId: dayIds[0]!, dayNumber: 1 }],
      })
    } catch (e) {
      rejection = e
    }
    assert.ok(
      rejection && violatesActiveRunIndex(rejection),
      "the partial unique index must stop a second concurrent run",
    )
    await generationRunStore.finishRun(run.id, "cancelled")
    // Cancelling frees the slot.
    const next = await generationRunStore.createRun({
      tripId,
      userId,
      mode: "generic",
      outline: null,
      creditsCharged: 1,
      days: dayIds.map((dayId, i) => ({ dayId, dayNumber: i + 1 })),
    })
    await generationRunStore.finishRun(next.id, "cancelled")
  })

  it("claims a day exactly once and charges the run exactly once", async () => {
    await resetRuns()
    const now = new Date()
    const run = await generationRunStore.createRun({
      tripId,
      userId,
      mode: "outline",
      outline: { days: [], avoidRepeats: [] },
      creditsCharged: 1,
      days: dayIds.map((dayId, i) => ({ dayId, dayNumber: i + 1 })),
    })
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          generationRunStore.claimDay(run.id, dayIds[0]!, now, STALE_CLAIM_MS),
        ),
      )
      assert.equal(
        results.filter(Boolean).length,
        1,
        "five concurrent claims must yield exactly one winner",
      )

      const [charged] = await db
        .select({ credits: tripGenerationRuns.creditsCharged })
        .from(tripGenerationRuns)
        .where(eq(tripGenerationRuns.id, run.id))
      assert.equal(charged?.credits, 2, "1 outline + 1 day, not 1 + 5")

      const reloaded = await generationRunStore.findRun(run.id)
      const day = reloaded?.days.find((d) => d.dayId === dayIds[0])
      assert.equal(day?.status, "in_progress")
      assert.equal(day?.attempts, 1)

      // A succeeded day is never re-claimable.
      await generationRunStore.markDay(run.id, dayIds[0]!, "succeeded", null)
      assert.equal(
        await generationRunStore.claimDay(
          run.id,
          dayIds[0]!,
          new Date(Date.now() + 1e9),
          STALE_CLAIM_MS,
        ),
        false,
      )

      // A fresh claim blocks; the same claim past the stale window does not.
      assert.equal(await generationRunStore.claimDay(run.id, dayIds[1]!, now, STALE_CLAIM_MS), true)
      assert.equal(
        await generationRunStore.claimDay(run.id, dayIds[1]!, now, STALE_CLAIM_MS),
        false,
        "a fresh in_progress claim must not be stolen",
      )
      const later = new Date(now.getTime() + STALE_CLAIM_MS + 1000)
      assert.equal(
        await generationRunStore.claimDay(run.id, dayIds[1]!, later, STALE_CLAIM_MS),
        true,
        "a stale claim must be reclaimable",
      )

      // A failed day is retryable.
      await generationRunStore.markDay(run.id, dayIds[2]!, "failed", "502 from the model")
      assert.equal(await generationRunStore.claimDay(run.id, dayIds[2]!, now, STALE_CLAIM_MS), true)

      // A day that is not part of this run cannot be claimed.
      assert.equal(
        await generationRunStore.claimDay(run.id, crypto.randomUUID(), now, STALE_CLAIM_MS),
        false,
      )
    } finally {
      await generationRunStore.finishRun(run.id, "cancelled")
    }
  })

  it("releaseDay reverses the tally only for a day that belongs to the run", async () => {
    await resetRuns()
    const run = await generationRunStore.createRun({
      tripId,
      userId,
      mode: "generic",
      outline: null,
      creditsCharged: 1,
      days: [{ dayId: dayIds[0]!, dayNumber: 1 }],
    })
    try {
      await generationRunStore.claimDay(run.id, dayIds[0]!, new Date(), STALE_CLAIM_MS)
      await generationRunStore.releaseDay(run.id, crypto.randomUUID())
      assert.equal(
        (await generationRunStore.findRun(run.id))?.creditsCharged,
        2,
        "an unrelated day id must not decrement the tally",
      )
      await generationRunStore.releaseDay(run.id, dayIds[0]!)
      assert.equal((await generationRunStore.findRun(run.id))?.creditsCharged, 1)
    } finally {
      await generationRunStore.finishRun(run.id, "cancelled")
    }
  })

  it("addRunDays adopts a new day and never resurrects one already generated", async () => {
    await resetRuns()
    const run = await generationRunStore.createRun({
      tripId,
      userId,
      mode: "generic",
      outline: null,
      creditsCharged: 0,
      days: [{ dayId: dayIds[0]!, dayNumber: 1 }],
    })
    try {
      await generationRunStore.markDay(run.id, dayIds[0]!, "succeeded", null)
      await generationRunStore.addRunDays(run.id, [
        { dayId: dayIds[0]!, dayNumber: 1 },
        { dayId: dayIds[1]!, dayNumber: 2 },
      ])
      const after = await generationRunStore.findRun(run.id)
      assert.equal(after?.days.length, 2, "the existing day must not be duplicated")
      assert.equal(
        after?.days.find((d) => d.dayId === dayIds[0])?.status,
        "succeeded",
        "ON CONFLICT DO NOTHING must leave the finished day finished",
      )
      assert.equal(after?.days.find((d) => d.dayId === dayIds[1])?.status, "pending")
    } finally {
      await generationRunStore.finishRun(run.id, "cancelled")
    }
  })

  it("findActiveRun ignores finished runs and other trips", async () => {
    await resetRuns()
    const run = await generationRunStore.createRun({
      tripId,
      userId,
      mode: "generic",
      outline: null,
      creditsCharged: 0,
      days: [{ dayId: dayIds[0]!, dayNumber: 1 }],
    })
    assert.equal((await generationRunStore.findActiveRun(tripId))?.id, run.id)
    assert.equal(await generationRunStore.findActiveRun(crypto.randomUUID()), null)
    await generationRunStore.finishRun(run.id, "completed")
    assert.equal(await generationRunStore.findActiveRun(tripId), null)
  })
})
