/** At or below this many credits left, the planner says so; above it, it stays quiet. */
export const LOW_CREDITS_THRESHOLD = 10

/**
 * A short notice for when AI credits are running low, or null when there is
 * nothing worth saying (plenty left, or the balance is unknown).
 */
export function lowCreditsNotice(remaining: number | null | undefined): string | null {
  if (remaining == null || remaining > LOW_CREDITS_THRESHOLD) return null
  if (remaining <= 0) return "You're out of AI credits. They reset next month."
  return `${remaining} AI ${remaining === 1 ? "credit" : "credits"} left this month.`
}
