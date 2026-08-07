/**
 * Step-metered pricing for the discuss endpoint.
 *
 * Deliberately free of any db import so the math stays unit-testable —
 * `ai-limits.ts` pulls in `server/db`, which throws without DATABASE_URL.
 */

/** Steps included in each credit. A turn is billed by which bracket it lands in. */
export const STEPS_PER_CREDIT = 8

/**
 * Hard ceiling on tool-call steps per discuss turn.
 *
 * This is a runaway guard, NOT a UX budget. Real turns land well under it; the
 * number exists so a pathological loop can't run into the function limit
 * (VERCEL_FUNCTION_MAX_DURATION_SECONDS), which would kill the request
 * mid-flight — and because the process dies, the refund in the endpoint's catch
 * block would never run, charging the user for nothing. At ~1-3s/step 30 steps
 * is ~90s, well past the 60s Hobby ceiling, so in practice TURN_TIME_BUDGET_MS
 * ends the tool phase first. That is intended: time is the real budget.
 *
 * Reaching this ceiling is not a failure: `prepareStep` strips the toolset on
 * the final step, so the agent always spends it writing a reply.
 */
export const MAX_DISCUSS_STEPS = 30

/**
 * Hard ceiling on tool-call steps for a THINKING turn.
 *
 * Higher than MAX_DISCUSS_STEPS because thinking mode buys the agent room to
 * research more before proposing — that extra room is part of what the 3x
 * charge pays for.
 *
 * This ceiling is ONLY safe in combination with the elapsed-time guard in
 * discuss.post.ts's prepareStep. Thinking mode runs ~8x slower per step, so 40
 * steps vastly exceed the function limit on step count alone — and a timeout
 * kills the process before the catch-block refund runs, billing the user 3x for
 * nothing. Time is the real budget; this is the secondary cap. If the time
 * guard is ever removed, drop this back to MAX_DISCUSS_STEPS.
 *
 * On the current 60s ceiling this number is effectively unreachable: the time
 * guard strips tools after a handful of thinking steps. It is kept as the
 * BILLING ceiling (creditsForSteps caps against it) and as headroom for a
 * larger plan, not as a step count any real turn will hit.
 */
export const MAX_DISCUSS_STEPS_THINKING = 40

/** Flat multiplier applied to a thinking turn's whole credit cost. */
export const THINKING_CREDIT_MULTIPLIER = 3

/** The step ceiling that applies to a turn, given its mode. */
export function discussStepCeiling(thinking: boolean): number {
  return thinking ? MAX_DISCUSS_STEPS_THINKING : MAX_DISCUSS_STEPS
}

/**
 * Credits owed for a turn that used `steps` tool-call steps.
 *
 * Bracketed rather than linear so ordinary conversation stays at 1 credit and
 * only genuine research binges cost more.
 *
 * `ceiling` must be the ceiling the turn actually ran under. It used to be
 * hard-coded to MAX_DISCUSS_STEPS, which silently under-billed a 40-step
 * thinking turn as though it had stopped at 30. Defaulted so every existing
 * single-argument caller is unchanged.
 */
export function creditsForSteps(steps: number, ceiling: number = MAX_DISCUSS_STEPS): number {
  if (!Number.isFinite(steps) || steps <= 0) return 1
  const capped = Math.min(steps, ceiling)
  return Math.max(1, Math.ceil(capped / STEPS_PER_CREDIT))
}

/**
 * The runtime cost note handed to the model each step, so it self-limits its
 * research spend.
 *
 * Used to be hardcoded to "one AI credit" regardless of mode. In thinking
 * mode a turn bills creditsForSteps(steps, 40) * THINKING_CREDIT_MULTIPLIER —
 * 3 credits per STEPS_PER_CREDIT steps — so the hardcoded note under-reported
 * the price by 3x in exactly the mode where a turn can reach 15 credits.
 */
export function stepCostNote(thinking: boolean): string {
  const credits = thinking ? THINKING_CREDIT_MULTIPLIER : 1
  const label = credits === 1 ? "one AI credit" : `${credits} AI credits`
  return `Every ${STEPS_PER_CREDIT} steps costs the user ${label}`
}

/**
 * The function timeout every wall-clock guard in this file sits under.
 *
 * This is NOT a description of a platform default — it is the value pinned in
 * `nuxt.config.ts` under `nitro.vercel.functions.maxDuration`. It used to be an
 * assumption: the budget below was written against "Vercel's 300s limit" while
 * no maxDuration was configured anywhere, so the platform applied its own plan
 * default. If that default were under 200s the guard could never fire — the
 * function would be killed mid-stream and settleCredits would never run, which
 * is the exact failure the guard exists to prevent.
 *
 * 60s is the Vercel HOBBY ceiling. Raising it requires a Pro plan or above; on
 * Hobby a higher value is rejected at build time. If the plan changes, raise
 * this and both budgets below together — the test asserts they keep headroom.
 *
 * Consequence worth knowing: at 60s the thinking-mode step ceiling
 * (MAX_DISCUSS_STEPS_THINKING) is unreachable in practice. Thinking runs ~8x
 * slower per step, so the wall-clock guard strips tools after a handful of
 * steps regardless of what the ceiling says. Time is the real budget; the step
 * count is a backstop, and on Hobby it is a backstop that never gets used.
 */
export const VERCEL_FUNCTION_MAX_DURATION_SECONDS = 60

/**
 * Wall-clock budget for one discuss turn's TOOL phase.
 *
 * Tools are stripped at this mark so the model still has ~20s to write its
 * reply inside VERCEL_FUNCTION_MAX_DURATION_SECONDS. This is what makes
 * MAX_DISCUSS_STEPS_THINKING safe: step count is a poor proxy for time when
 * thinking mode runs ~8x slower per step, and a timeout kills the process
 * before the endpoint's refund can run.
 */
export const TURN_TIME_BUDGET_MS = 40_000

/**
 * Wall-clock budget for the model phase of one day generation.
 *
 * Day generation had no time guard at all: it charges up front, and
 * `withOneRetry` can run the model TWICE at ~8x thinking latency. A timeout
 * killed the process after the credit was consumed but before `refundOnce`,
 * so the traveler paid for nothing — and a run-bound request left its `runId`
 * claimed until the stale-claim window expired.
 *
 * Deliberately well under the function limit: Google Places enrichment, the
 * segment recompute and the DB writes all run AFTER the model returns, and
 * they need room inside the same invocation.
 */
export const GENERATION_MODEL_BUDGET_MS = 35_000

/** What a maxed-out thinking discuss turn actually bills. */
export function worstCaseThinkingCredits(): number {
  return (
    creditsForSteps(MAX_DISCUSS_STEPS_THINKING, MAX_DISCUSS_STEPS_THINKING) *
    THINKING_CREDIT_MULTIPLIER
  )
}

/**
 * Whether a traveler with `remaining` credits can be given thinking mode.
 *
 * `tryConsumeAiCredit` gates on ONE credit and the remainder is charged
 * afterwards without a limit check, so a user at 99/100 could finish a
 * research-heavy thinking turn at 114/100. Checking the WORST case up front
 * means the ceiling can never be breached rather than merely breached less.
 *
 * `cost` defaults to the stepped discuss worst case; day generation passes its
 * flat THINKING_CREDIT_MULTIPLIER instead, because that endpoint cannot bill
 * more than that.
 *
 * The caller downgrades to normal mode rather than refusing the request — the
 * traveler still gets their answer, just at the normal price.
 */
export function canAffordThinking(remaining: number, cost: number = worstCaseThinkingCredits()) {
  if (!Number.isFinite(remaining)) return false
  return remaining >= cost
}

/**
 * Whether this step must run without tools — either it is the last permitted
 * step, or the turn has spent its time budget.
 *
 * Pure so the policy is testable; the endpoint supplies the elapsed time.
 */
export function shouldStripTools(stepNumber: number, ceiling: number, elapsedMs: number): boolean {
  if (elapsedMs > TURN_TIME_BUDGET_MS) return true
  return ceiling - stepNumber <= 1
}

/**
 * How much of `creditsCharged` has actually been taken from the ledger at a
 * given point in a day-generation request (Finding 3, whole-branch review).
 *
 * `chargeExtraAiCredits` used to run BEFORE `processUserRequest`, so every
 * failure path refunded the full `creditsCharged` correctly. Moving that
 * charge to run only AFTER the model call succeeds (so a timed-out or failed
 * generation is never billed for work that never happened) means a failure
 * BEFORE that point has only ever consumed the flat 1-credit
 * `tryConsumeAiCredit` — refunding the full `creditsCharged` there would mint
 * the difference as free credits. A failure AFTER the extra charge succeeded
 * must still refund the full amount.
 *
 * `extraChargeApplied` is true once `chargeExtraAiCredits` has been awaited
 * without throwing; false at every point before that.
 */
export function chargedSoFar(creditsCharged: number, extraChargeApplied: boolean): number {
  return extraChargeApplied ? creditsCharged : 1
}
