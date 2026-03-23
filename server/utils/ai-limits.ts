import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { aiUsage } from "../db/schema";

const MONTHLY_LIMIT = 100;

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getResetDate(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/**
 * Get the current AI usage for a user this month.
 */
export async function getAiUsage(userId: string): Promise<{ used: number; limit: number; remaining: number }> {
  const month = getCurrentMonth();

  const record = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)),
  });

  const used = record?.promptCount ?? 0;
  return { used, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - used) };
}

/**
 * Check if the user can make an AI prompt. Throws 429 if limit exceeded.
 */
export async function checkAiLimit(userId: string): Promise<void> {
  const { used, limit } = await getAiUsage(userId);

  if (used >= limit) {
    throw createError({
      statusCode: 429,
      message: `You've used ${used}/${limit} AI prompts this month. Your limit resets on ${getResetDate()}.`,
    });
  }
}

/**
 * Increment the AI usage counter for a user.
 */
export async function incrementAiUsage(userId: string): Promise<void> {
  const month = getCurrentMonth();

  const existing = await db.query.aiUsage.findFirst({
    where: and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)),
  });

  if (existing) {
    await db
      .update(aiUsage)
      .set({ promptCount: existing.promptCount + 1 })
      .where(eq(aiUsage.id, existing.id));
  } else {
    await db.insert(aiUsage).values({
      userId,
      month,
      promptCount: 1,
    });
  }
}
