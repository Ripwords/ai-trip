/**
 * Postgres implementation of `GenerationRunStore`.
 *
 * Kept apart from `generation-run.ts` so the run logic stays importable (and
 * unit-testable) without `server/db`, which throws when DATABASE_URL is unset.
 */

import { and, asc, eq, inArray, or, sql } from "drizzle-orm"
import { db } from "../db"
import {
  tripGenerationRunDays,
  tripGenerationRuns,
  itineraryDays,
  activities,
  type StoredOutline,
} from "../db/schema"
import type {
  GenerationRunRecord,
  GenerationRunStore,
  RunDayStatus,
  RunMode,
  RunStatus,
  TripDaySnapshot,
} from "./generation-run"
import type { TripOutline } from "./trip-outline"

type RunRow = typeof tripGenerationRuns.$inferSelect
type RunDayRow = typeof tripGenerationRunDays.$inferSelect

const RUN_STATUSES: RunStatus[] = ["running", "completed", "cancelled"]
const DAY_STATUSES: RunDayStatus[] = ["pending", "in_progress", "succeeded", "failed"]

/**
 * `status`/`mode` are text columns, so a hand-edited or future value must not
 * be trusted into the union. Anything unrecognised is treated as the safest
 * option: a run that is not running, and a day that is merely pending.
 */
function toRunStatus(value: string): RunStatus {
  return RUN_STATUSES.find((s) => s === value) ?? "completed"
}

function toDayStatus(value: string): RunDayStatus {
  return DAY_STATUSES.find((s) => s === value) ?? "pending"
}

function toMode(value: string): RunMode {
  return value === "outline" ? "outline" : "generic"
}

function toRecord(run: RunRow, days: RunDayRow[]): GenerationRunRecord {
  return {
    id: run.id,
    tripId: run.tripId,
    userId: run.userId,
    status: toRunStatus(run.status),
    mode: toMode(run.mode),
    outline: (run.outline as TripOutline | null) ?? null,
    creditsCharged: run.creditsCharged,
    days: days.map((d) => ({
      dayId: d.dayId,
      dayNumber: d.dayNumber,
      status: toDayStatus(d.status),
      attempts: d.attempts,
      lastError: d.lastError,
      claimedAt: d.claimedAt,
    })),
  }
}

async function loadDays(runId: string): Promise<RunDayRow[]> {
  return db
    .select()
    .from(tripGenerationRunDays)
    .where(eq(tripGenerationRunDays.runId, runId))
    .orderBy(asc(tripGenerationRunDays.dayNumber))
}

export const generationRunStore: GenerationRunStore = {
  async findActiveRun(tripId: string): Promise<GenerationRunRecord | null> {
    const [run] = await db
      .select()
      .from(tripGenerationRuns)
      .where(and(eq(tripGenerationRuns.tripId, tripId), eq(tripGenerationRuns.status, "running")))
      .limit(1)
    if (!run) return null
    return toRecord(run, await loadDays(run.id))
  },

  async findRun(runId: string): Promise<GenerationRunRecord | null> {
    const [run] = await db
      .select()
      .from(tripGenerationRuns)
      .where(eq(tripGenerationRuns.id, runId))
      .limit(1)
    if (!run) return null
    return toRecord(run, await loadDays(run.id))
  },

  async createRun(input) {
    return db.transaction(async (tx) => {
      const [run] = await tx
        .insert(tripGenerationRuns)
        .values({
          tripId: input.tripId,
          userId: input.userId,
          status: "running",
          mode: input.mode,
          outline: (input.outline as StoredOutline | null) ?? null,
          creditsCharged: input.creditsCharged,
        })
        .returning()
      if (!run) throw new Error("failed to create generation run")

      if (input.days.length === 0) return toRecord(run, [])

      const dayRows = await tx
        .insert(tripGenerationRunDays)
        .values(
          input.days.map((d) => ({
            runId: run.id,
            dayId: d.dayId,
            dayNumber: d.dayNumber,
          })),
        )
        .returning()
      return toRecord(
        run,
        dayRows.toSorted((a, b) => a.dayNumber - b.dayNumber),
      )
    })
  },

  async addRunDays(runId, days) {
    if (days.length === 0) return
    await db
      .insert(tripGenerationRunDays)
      .values(days.map((d) => ({ runId, dayId: d.dayId, dayNumber: d.dayNumber })))
      // A day already on the run keeps its status — adoption must never
      // resurrect a day this run already generated.
      .onConflictDoNothing({
        target: [tripGenerationRunDays.runId, tripGenerationRunDays.dayId],
      })
  },

  /**
   * The whole idempotency guarantee lives in this one statement: a single
   * conditional UPDATE whose WHERE mirrors `isClaimable`. Two concurrent
   * callers race on the same row, one wins, the loser gets zero rows back and
   * therefore never reaches `tryConsumeAiCredit`.
   */
  async claimDay(runId, dayId, now, staleAfterMs) {
    const staleBefore = new Date(now.getTime() - staleAfterMs)
    const claimed = await db
      .update(tripGenerationRunDays)
      .set({
        status: "in_progress",
        claimedAt: now,
        attempts: sql`${tripGenerationRunDays.attempts} + 1`,
      })
      .where(
        and(
          eq(tripGenerationRunDays.runId, runId),
          eq(tripGenerationRunDays.dayId, dayId),
          or(
            inArray(tripGenerationRunDays.status, ["pending", "failed"]),
            and(
              eq(tripGenerationRunDays.status, "in_progress"),
              or(
                sql`${tripGenerationRunDays.claimedAt} IS NULL`,
                sql`${tripGenerationRunDays.claimedAt} <= ${staleBefore}`,
              ),
            ),
          ),
        ),
      )
      .returning({ id: tripGenerationRunDays.id })

    if (claimed.length === 0) return false

    await db
      .update(tripGenerationRuns)
      .set({ creditsCharged: sql`${tripGenerationRuns.creditsCharged} + 1` })
      .where(eq(tripGenerationRuns.id, runId))
    return true
  },

  async markDay(runId, dayId, status, error) {
    await db
      .update(tripGenerationRunDays)
      .set({ status, lastError: error, claimedAt: null })
      .where(and(eq(tripGenerationRunDays.runId, runId), eq(tripGenerationRunDays.dayId, dayId)))
  },

  async releaseDay(runId, dayId) {
    // Guarded on the day actually belonging to the run so a bad id can't
    // silently decrement someone else's tally.
    const [day] = await db
      .select({ id: tripGenerationRunDays.id })
      .from(tripGenerationRunDays)
      .where(and(eq(tripGenerationRunDays.runId, runId), eq(tripGenerationRunDays.dayId, dayId)))
      .limit(1)
    if (!day) return
    await db
      .update(tripGenerationRuns)
      .set({ creditsCharged: sql`GREATEST(${tripGenerationRuns.creditsCharged} - 1, 0)` })
      .where(eq(tripGenerationRuns.id, runId))
  },

  async finishRun(runId, status) {
    await db
      .update(tripGenerationRuns)
      .set({ status })
      .where(and(eq(tripGenerationRuns.id, runId), eq(tripGenerationRuns.status, "running")))
  },
}

/**
 * Live per-day activity counts — the source of truth for "this day is done".
 * Counted in SQL rather than by loading activities so a 20-day trip is one
 * cheap query.
 */
export async function getTripDaySnapshot(tripId: string): Promise<TripDaySnapshot[]> {
  const rows = await db
    .select({
      dayId: itineraryDays.id,
      dayNumber: itineraryDays.dayNumber,
      activityCount: sql<number>`count(${activities.id})::int`,
    })
    .from(itineraryDays)
    .leftJoin(activities, eq(activities.itineraryDayId, itineraryDays.id))
    .where(eq(itineraryDays.tripId, tripId))
    .groupBy(itineraryDays.id, itineraryDays.dayNumber)
    .orderBy(asc(itineraryDays.dayNumber))
  return rows.map((r) => ({
    dayId: r.dayId,
    dayNumber: r.dayNumber,
    activityCount: Number(r.activityCount),
  }))
}
