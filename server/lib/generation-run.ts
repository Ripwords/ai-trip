/**
 * Durable state for a "Generate full itinerary" run.
 *
 * The full-trip flow is a client-driven loop: one outline call, then one
 * `POST /days/:dayId/ai` per empty day, in day order. Before this module the
 * loop existed only in the browser tab, so closing it lost the outline and the
 * progress, and re-running re-charged for days that had already succeeded.
 *
 * A run row makes that loop resumable. Three rules keep resume honest:
 *
 *  1. **The database is the source of truth for "done".** A day that has
 *     activities is never offered again, regardless of what the run row says —
 *     so a day filled by hand, or by another tab, is never clobbered.
 *  2. **A day is claimed before its credit is consumed.** `claimDay` is a
 *     conditional UPDATE; if it does not win, the caller returns without
 *     calling `tryConsumeAiCredit`. Two tabs resuming the same run therefore
 *     cannot both charge for the same day.
 *  3. **The outline is paid for once per run.** Resuming reuses the stored
 *     outline and never calls the model again.
 *
 * Deliberately free of any `server/db` import so the logic stays unit-testable:
 * persistence is behind `GenerationRunStore` (see `generation-run-store.ts`).
 */

import type { TripOutline } from "./trip-outline"

/**
 * How long a claim stays authoritative before another attempt may take the day.
 *
 * A crashed tab leaves `in_progress` behind with nobody to clear it, so claims
 * must expire or the day would be stuck forever. Five minutes is comfortably
 * longer than the slowest real day generation (research + generateObject +
 * Places enrichment + Distance Matrix, well under Vercel's 300s ceiling) and
 * short enough that a traveler who closed the tab mid-day can retry that day
 * without waiting around.
 */
export const STALE_CLAIM_MS = 5 * 60_000

export type RunDayStatus = "pending" | "in_progress" | "succeeded" | "failed"
export type RunStatus = "running" | "completed" | "cancelled"
export type RunMode = "outline" | "generic"

export interface RunDayRecord {
  dayId: string
  dayNumber: number
  status: RunDayStatus
  attempts: number
  lastError: string | null
  claimedAt: Date | null
}

export interface GenerationRunRecord {
  id: string
  tripId: string
  userId: string
  status: RunStatus
  mode: RunMode
  outline: TripOutline | null
  /** Credits this run has spent so far — outline plus every claimed day. */
  creditsCharged: number
  days: RunDayRecord[]
}

/** What the trip's days look like right now, straight from the database. */
export interface TripDaySnapshot {
  dayId: string
  dayNumber: number
  activityCount: number
}

export interface GenerationRunStore {
  findActiveRun(tripId: string): Promise<GenerationRunRecord | null>
  findRun(runId: string): Promise<GenerationRunRecord | null>
  createRun(input: {
    tripId: string
    userId: string
    mode: RunMode
    outline: TripOutline | null
    creditsCharged: number
    days: { dayId: string; dayNumber: number }[]
  }): Promise<GenerationRunRecord>
  /**
   * Add days to a live run. MUST be a no-op for days already on the run (the
   * (run_id, day_id) unique index + ON CONFLICT DO NOTHING), so adoption can be
   * retried without duplicating a day or resurrecting a finished one.
   */
  addRunDays(runId: string, days: { dayId: string; dayNumber: number }[]): Promise<void>
  /**
   * Conditional claim. MUST apply the same predicate as `isClaimable` inside a
   * single statement, and MUST increment the run's credit tally in the same
   * statement, so concurrent callers cannot both win.
   */
  claimDay(runId: string, dayId: string, now: Date, staleAfterMs: number): Promise<boolean>
  markDay(
    runId: string,
    dayId: string,
    status: "succeeded" | "failed",
    error: string | null,
  ): Promise<void>
  /** Reverses a claim's credit tally when the endpoint refunded the credit. */
  releaseDay(runId: string, dayId: string): Promise<void>
  finishRun(runId: string, status: "completed" | "cancelled"): Promise<void>
}

/**
 * Whether this day may be (re)claimed. `in_progress` is only claimable once the
 * claim has gone stale — a missing `claimedAt` counts as stale rather than as
 * fresh, so a half-written row can never wedge a day permanently.
 */
export function isClaimable(
  day: RunDayRecord,
  now: Date,
  staleAfterMs: number = STALE_CLAIM_MS,
): boolean {
  if (day.status === "succeeded") return false
  if (day.status !== "in_progress") return true
  if (!day.claimedAt) return true
  return now.getTime() - day.claimedAt.getTime() >= staleAfterMs
}

/**
 * Days this run still has work for, in day order.
 *
 * Filtered against the live snapshot on purpose: a day that has activities is
 * finished no matter what the run row claims, and a day that has been deleted
 * from the trip is dropped rather than generated into a void.
 */
export function remainingRunDays(
  run: GenerationRunRecord,
  snapshot: TripDaySnapshot[],
  now: Date,
  staleAfterMs: number = STALE_CLAIM_MS,
): RunDayRecord[] {
  const byId = new Map(snapshot.map((d) => [d.dayId, d]))
  return run.days
    .filter((day) => {
      const live = byId.get(day.dayId)
      if (!live) return false
      if (live.activityCount > 0) return false
      return isClaimable(day, now, staleAfterMs)
    })
    .toSorted((a, b) => a.dayNumber - b.dayNumber)
}

export interface RunSummary {
  total: number
  generated: number
  failed: number
  remaining: number
  creditsCharged: number
}

export function summarizeRun(
  run: GenerationRunRecord,
  snapshot: TripDaySnapshot[],
  now: Date,
  staleAfterMs: number = STALE_CLAIM_MS,
): RunSummary {
  const byId = new Map(snapshot.map((d) => [d.dayId, d]))
  const live = run.days.filter((d) => byId.has(d.dayId))
  const generated = live.filter(
    (d) => (byId.get(d.dayId)?.activityCount ?? 0) > 0 || d.status === "succeeded",
  )
  const failed = live.filter(
    (d) => d.status === "failed" && (byId.get(d.dayId)?.activityCount ?? 0) === 0,
  )
  return {
    total: live.length,
    generated: generated.length,
    failed: failed.length,
    remaining: remainingRunDays(run, snapshot, now, staleAfterMs).length,
    creditsCharged: run.creditsCharged,
  }
}

export interface StartOrResumeInput {
  store: GenerationRunStore
  tripId: string
  userId: string
  /** Empty days the caller wants generated, used only when creating a new run. */
  emptyDays: { dayId: string; dayNumber: number }[]
  snapshot: TripDaySnapshot[]
  now: Date
  buildOutline: () => Promise<TripOutline>
  consumeCredit: () => Promise<void>
  refundCredit: () => Promise<void>
  /**
   * Create the run WITHOUT buying a trip-level plan. Set when the traveler
   * hasn't enough credits left to cover the outline plus every day — the days
   * are worth more to them than the plan.
   */
  skipOutline?: boolean
  staleAfterMs?: number
}

export interface StartOrResumeResult {
  run: GenerationRunRecord
  /** True when an existing run was picked up — no credit was spent. */
  resumed: boolean
  remaining: RunDayRecord[]
}

async function adoptDays(
  store: GenerationRunStore,
  runId: string,
  days: { dayId: string; dayNumber: number }[],
): Promise<GenerationRunRecord> {
  await store.addRunDays(runId, days)
  const reloaded = await store.findRun(runId)
  if (!reloaded) throw new Error(`generation run ${runId} vanished while adopting days`)
  return reloaded
}

/**
 * Start a run, or pick up the trip's active one.
 *
 * Resume spends nothing: no outline credit, no outline model call. Only a trip
 * with no active run (or whose active run has no work left) pays again.
 */
export async function startOrResumeRun(input: StartOrResumeInput): Promise<StartOrResumeResult> {
  const { store, tripId, userId, snapshot, now, staleAfterMs = STALE_CLAIM_MS } = input

  const active = await store.findActiveRun(tripId)
  if (active) {
    // Days added to the trip since the run started are adopted into it. Without
    // this they could never be generated: the trip's single active-run slot is
    // taken, so pressing Generate again would just resume the old day set.
    // Adoption is free — the run's outline won't cover a day it never saw, so
    // that day falls back to the generic prompt rather than buying a new plan.
    const known = new Set(active.days.map((d) => d.dayId))
    const adopted = input.emptyDays.filter((d) => !known.has(d.dayId))
    const run = adopted.length > 0 ? await adoptDays(store, active.id, adopted) : active

    const remaining = remainingRunDays(run, snapshot, now, staleAfterMs)
    if (remaining.length > 0) return { run, resumed: true, remaining }
    // Nothing left to do — retire it so a new run can take the trip's slot.
    await store.finishRun(run.id, "completed")
  }

  // Defence in depth behind the endpoint's own check: creating a run with no
  // days would consume an outline credit for a plan nothing could ever use.
  // Thrown as a plain Error rather than via h3's `createError` so this module
  // stays free of Nitro auto-imports and unit-testable outside Nuxt; h3 reads
  // `statusCode` off any thrown object.
  if (input.emptyDays.length === 0) {
    throw Object.assign(new Error("This trip has no days left to generate."), {
      statusCode: 400,
    })
  }

  let outline: TripOutline | null = null
  let refunded = false
  /** What the traveler actually paid for this run's plan: 1 or 0. */
  let outlineCredits = 0
  const refundOnce = async (): Promise<void> => {
    if (refunded) return
    refunded = true
    outlineCredits = 0
    await input.refundCredit()
  }

  if (!input.skipOutline) {
    // Consume BEFORE the model call, mirroring generate-outline.post.ts. Every
    // failure below refunds exactly once — `refunded` is the single guard,
    // because refundAiCredit is GREATEST(count - 1, 0) and calling it twice
    // for one consume mints the traveler a free credit.
    await input.consumeCredit()
    outlineCredits = 1
    try {
      const built = await input.buildOutline()
      // A 200 with zero usable days bought nothing — same rule the outline
      // endpoint applies, and the run falls back to generic per-day prompts.
      outline = built.days.length > 0 ? built : null
      if (!outline) await refundOnce()
    } catch {
      // Best-effort, exactly as before: a failed outline downgrades the run to
      // generic prompts rather than blocking generation entirely.
      await refundOnce()
    }
  }

  try {
    const run = await store.createRun({
      tripId,
      userId,
      mode: outline ? "outline" : "generic",
      outline,
      creditsCharged: outlineCredits,
      days: input.emptyDays.map((d) => ({ dayId: d.dayId, dayNumber: d.dayNumber })),
    })
    return {
      run,
      resumed: false,
      remaining: remainingRunDays(run, snapshot, now, staleAfterMs),
    }
  } catch (e) {
    // The run was never persisted, so nothing can resume and reuse the outline
    // the traveler just paid for.
    await refundOnce()
    throw e
  }
}

export type BeginDayResult =
  /** The caller owns this day and may spend a credit on it. */
  | "claimed"
  /** Already generated in this run — the caller must return without charging. */
  | "already-done"
  /** Another attempt holds a fresh claim; the caller must not charge either. */
  | "in-flight"
  /** No such run/day for this user, or the run is finished. */
  | "not-found"

/**
 * Take ownership of one day of a run. MUST be called before consuming the
 * day's AI credit — that ordering is what makes resume idempotent.
 */
export async function beginRunDay(
  store: GenerationRunStore,
  input: {
    runId: string
    dayId: string
    userId: string
    now: Date
    staleAfterMs?: number
  },
): Promise<BeginDayResult> {
  const staleAfterMs = input.staleAfterMs ?? STALE_CLAIM_MS
  const run = await store.findRun(input.runId)
  if (!run || run.userId !== input.userId || run.status !== "running") return "not-found"

  const day = run.days.find((d) => d.dayId === input.dayId)
  if (!day) return "not-found"
  if (day.status === "succeeded") return "already-done"

  const claimed = await store.claimDay(input.runId, input.dayId, input.now, staleAfterMs)
  if (claimed) return "claimed"

  // Lost the race. Re-read to tell "someone finished it" from "someone is
  // still working on it" — the caller reports these differently.
  const after = await store.findRun(input.runId)
  const afterDay = after?.days.find((d) => d.dayId === input.dayId)
  if (!after || !afterDay) return "not-found"
  return afterDay.status === "succeeded" ? "already-done" : "in-flight"
}

/**
 * Record how a day turned out. `refunded` reverses the run's credit tally for
 * a day whose endpoint refunded its credit, so the tally shown to the traveler
 * stays equal to what they were actually billed.
 */
export async function endRunDay(
  store: GenerationRunStore,
  input: {
    runId: string
    dayId: string
    ok: boolean
    error?: string | null
    refunded?: boolean
  },
): Promise<void> {
  if (input.refunded) await store.releaseDay(input.runId, input.dayId)
  await store.markDay(
    input.runId,
    input.dayId,
    input.ok ? "succeeded" : "failed",
    input.ok ? null : (input.error ?? null),
  )
}
