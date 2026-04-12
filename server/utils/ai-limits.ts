import { eq, and, sql, lt } from "drizzle-orm"
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
 * Handles the case where no record exists yet for the current month.
 */
export async function tryConsumeAiCredit(userId: string): Promise<boolean> {
  const currentMonthYear = getCurrentMonth()

  // Attempt atomic increment: only succeeds if promptCount < MONTHLY_LIMIT
  const result = await db
    .update(aiUsage)
    .set({ promptCount: sql`${aiUsage.promptCount} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.month, currentMonthYear),
        lt(aiUsage.promptCount, MONTHLY_LIMIT),
      ),
    )
    .returning()

  if (result.length > 0) {
    return true
  }

  // No rows updated — either no record exists for this month, or limit was reached.
  const existing = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.month, currentMonthYear)),
  })

  if (!existing) {
    // First usage this month — insert with count = 1
    await db.insert(aiUsage).values({ userId, month: currentMonthYear, promptCount: 1 })
    return true
  }

  // Record exists but update didn't match — limit reached
  throw createError({
    statusCode: 429,
    message: `You've used ${existing.promptCount}/${MONTHLY_LIMIT} AI prompts this month. Your limit resets on ${getResetDate()}.`,
  })
}
