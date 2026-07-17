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
 * Credits owed for a turn that used `steps` tool-call steps.
 *
 * Bracketed rather than linear so ordinary conversation stays at 1 credit and
 * only genuine research binges cost more.
 */
export function creditsForSteps(steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 1
  const capped = Math.min(steps, MAX_DISCUSS_STEPS)
  return Math.max(1, Math.ceil(capped / STEPS_PER_CREDIT))
}
