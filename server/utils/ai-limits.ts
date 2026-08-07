import { eq, and, sql } from "drizzle-orm"
import { db } from "../db"
import { aiUsage } from "../db/schema"

const MONTHLY_LIMIT = 100

/**
 * The `YYYY-MM` bucket a credit is attributed to.
 *
 * UTC, not server-local: the old local-time version moved the month boundary with
 * the deploy region, so the same instant could be attributed to two different
 * months depending on where the function happened to run.
 *
 * Callers that need to settle later MUST capture this at consume time and thread
 * it through — recomputing it at settle time is exactly the bug in issue #17.
 */
export function getUsageMonth(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`
}

function getResetDate(): string {
  const now = new Date()
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return nextMonth.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

/**
 * Get the current AI usage for a user this month.
 */
export async function getAiUsage(
  userId: string,
): Promise<{ used: number; limit: number; remaining: number }> {
  const month = getUsageMonth()

  const record = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)),
  })

  const used = record?.promptCount ?? 0
  return { used, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - used) }
}

/**
 * Atomically consume one AI credit. Returns the `YYYY-MM` month the credit was
 * charged to. Throws 429 if the monthly limit has been reached.
 *
 * Single upsert keyed on the (userId, month) unique index. The WHERE clause on
 * the conflict branch prevents incrementing past the limit, and the lack of any
 * separate INSERT path eliminates a check-then-insert race that previously let
 * two concurrent first-of-month calls each grant themselves a credit.
 *
 * The returned month is the reservation handle: pass it to `refundAiCredit` /
 * `chargeExtraAiCredits` so a turn that starts at 23:59:50 on the last day of the
 * month and settles seconds later still settles against the row it incremented.
 */
export async function tryConsumeAiCredit(userId: string): Promise<string> {
  const currentMonthYear = getUsageMonth()

  const result = await db
    .insert(aiUsage)
    .values({ userId, month: currentMonthYear, promptCount: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.month],
      set: { promptCount: sql`${aiUsage.promptCount} + 1`, updatedAt: new Date() },
      setWhere: sql`${aiUsage.promptCount} < ${MONTHLY_LIMIT}`,
    })
    .returning()

  if (result.length > 0) return currentMonthYear

  // Conflict matched but setWhere rejected the update → limit hit. Read the
  // current count to build a helpful error message.
  const existing = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.month, currentMonthYear)),
  })
  throw createError({
    statusCode: 429,
    message: `You've used ${existing?.promptCount ?? MONTHLY_LIMIT}/${MONTHLY_LIMIT} AI prompts this month. Your limit resets on ${getResetDate()}.`,
  })
}

/**
 * Charge additional credits for a turn that has ALREADY done the work, on top of
 * the single credit `tryConsumeAiCredit` took up front.
 *
 * Unlike `tryConsumeAiCredit` this cannot refuse: the Gemini and Places calls are
 * already spent, so rejecting here would give the work away for free. It therefore
 * has no `setWhere` guard and may carry a user past MONTHLY_LIMIT — a heavy final
 * turn can land them at e.g. 103/100. That is intended and self-correcting: the
 * next `tryConsumeAiCredit` sees promptCount >= limit and throws 429.
 *
 * `extra` is the count BEYOND the credit already consumed. Non-positive is a no-op.
 *
 * `month` is the value `tryConsumeAiCredit` returned for this turn, NOT the month
 * at settle time: a turn that consumed at 23:59:50 on the last day of the month
 * and settles at 00:00:05 would otherwise scope its UPDATE by the *next* month,
 * match zero rows, and hand the extra steps over for free (issue #17).
 */
export async function chargeExtraAiCredits(
  userId: string,
  extra: number,
  month: string,
): Promise<void> {
  if (!Number.isFinite(extra) || extra <= 0) return
  await db
    .update(aiUsage)
    .set({ promptCount: sql`${aiUsage.promptCount} + ${Math.floor(extra)}`, updatedAt: new Date() })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)))
}

/**
 * Refund AI credits. Use after a planning step fails and no work was committed.
 * Does NOT go below zero.
 *
 * `amount` defaults to 1. A thinking-mode turn charges
 * THINKING_CREDIT_MULTIPLIER credits up front, so its failure paths MUST refund
 * the same number — the default-1 version pocketed 2 of every failed 3-credit
 * generation.
 *
 * NOT idempotent: the SQL is `GREATEST(count - amount, 0)`, so calling this
 * twice for a single consume decrements twice and mints the user free credits.
 * Each request must refund at most once — where a handler has several failure
 * paths, route them all through one guard (see discuss.post.ts's
 * `settleCredits` and ai.post.ts's `refundOnce`).
 *
 * `month` is the value `tryConsumeAiCredit` returned for this turn. Recomputing
 * "now" here would match zero rows across a month boundary and silently leave the
 * user charged (issue #17).
 */
export async function refundAiCredit(
  userId: string,
  month: string,
  amount: number = 1,
): Promise<void> {
  const n = Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1
  await db
    .update(aiUsage)
    .set({ promptCount: sql`GREATEST(${aiUsage.promptCount} - ${n}, 0)`, updatedAt: new Date() })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)))
}
