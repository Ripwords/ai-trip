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
 * number exists so a pathological loop can't run into Vercel's 300s function
 * limit, which would kill the request mid-flight — and because the process dies,
 * the refund in the endpoint's catch block would never run, charging the user
 * for nothing. At ~1-3s/step this caps a worst case around 90s.
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
 * steps can exceed Vercel's 300s function limit on step count alone — and a
 * timeout kills the process before the catch-block refund runs, billing the
 * user 3x for nothing. Time is the real budget; this is the secondary cap.
 * If the time guard is ever removed, drop this back to MAX_DISCUSS_STEPS.
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
 * Wall-clock budget for one discuss turn's TOOL phase.
 *
 * Vercel's function limit is 300s. Tools are stripped at this mark so the model
 * still has ~100s to write its reply inside that limit. This is what makes
 * MAX_DISCUSS_STEPS_THINKING safe: step count is a poor proxy for time when
 * thinking mode runs ~8x slower per step, and a timeout kills the process
 * before the endpoint's refund can run.
 */
export const TURN_TIME_BUDGET_MS = 200_000

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
