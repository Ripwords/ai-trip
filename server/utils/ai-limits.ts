import { eq, and, sql } from "drizzle-orm"
import { db } from "../db"
import { aiUsage } from "../db/schema"

const MONTHLY_LIMIT = 100

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function getResetDate(): string {
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return nextMonth.toLocaleDateString("en-US", { month: "long", day: "numeric" })
}

/**
 * Get the current AI usage for a user this month.
 */
export async function getAiUsage(
  userId: string,
): Promise<{ used: number; limit: number; remaining: number }> {
  const month = getCurrentMonth()

  const record = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)),
  })

  const used = record?.promptCount ?? 0
  return { used, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - used) }
}

/**
 * Atomically consume one AI credit. Returns true if successful.
 * Throws 429 if the monthly limit has been reached.
 *
 * Single upsert keyed on the (userId, month) unique index. The WHERE clause on
 * the conflict branch prevents incrementing past the limit, and the lack of any
 * separate INSERT path eliminates a check-then-insert race that previously let
 * two concurrent first-of-month calls each grant themselves a credit.
 */
export async function tryConsumeAiCredit(userId: string): Promise<boolean> {
  const currentMonthYear = getCurrentMonth()

  const result = await db
    .insert(aiUsage)
    .values({ userId, month: currentMonthYear, promptCount: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.month],
      set: { promptCount: sql`${aiUsage.promptCount} + 1`, updatedAt: new Date() },
      setWhere: sql`${aiUsage.promptCount} < ${MONTHLY_LIMIT}`,
    })
    .returning()

  if (result.length > 0) return true

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
 * Refund one AI credit. Use after a planning step fails and no work was committed.
 * Does NOT go below zero. Safe to call multiple times if a single consume succeeded.
 */
export async function refundAiCredit(userId: string): Promise<void> {
  const month = getCurrentMonth()
  await db
    .update(aiUsage)
    .set({ promptCount: sql`GREATEST(${aiUsage.promptCount} - 1, 0)`, updatedAt: new Date() })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)))
}
