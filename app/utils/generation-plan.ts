/**
 * Decides how a "Generate full itinerary" run should spend AI credits.
 *
 * The outline path costs N+1 prompts (1 trip-level plan + 1 per day). When the
 * traveler doesn't have that many left, planning is skipped rather than burning
 * a scarce credit on it, and days fall back to the generic prompt.
 */

export interface GenerationConfirm {
  title: string
  message: string
  confirmText: string
}

export type GenerationPlan =
  | { mode: "none" }
  | { mode: "outline"; dayCount: number; confirm: GenerationConfirm }
  | { mode: "generic"; dayCount: number; confirm: GenerationConfirm }

export function planGenerationRun(emptyDayCount: number, aiRemaining?: number): GenerationPlan {
  if (emptyDayCount <= 0) return { mode: "none" }

  const dayWord = emptyDayCount === 1 ? "day" : "days"

  if (aiRemaining == null || aiRemaining >= emptyDayCount + 1) {
    return {
      mode: "outline",
      dayCount: emptyDayCount,
      confirm: {
        title: "Generate full itinerary",
        message: `AI will plan your ${emptyDayCount} empty ${dayWord} together — themes, areas, and pacing — then fill each one. Uses ${emptyDayCount + 1} AI prompts (1 to plan the trip, 1 per day).`,
        confirmText: "Generate",
      },
    }
  }

  // aiRemaining === 0 still attempts one day so the server's 429 surfaces to
  // the user as an error instead of the run silently doing nothing.
  const dayCount = aiRemaining === 0 ? 1 : Math.min(aiRemaining, emptyDayCount)

  return {
    mode: "generic",
    dayCount,
    confirm: {
      title: "Not enough AI prompts",
      message: `Planning the whole trip needs ${emptyDayCount + 1} prompts (1 to plan, 1 per day) but you have ${aiRemaining} left this month. Skip trip-level planning and fill ${dayCount} ${dayCount === 1 ? "day" : "days"} instead?`,
      confirmText: "Continue anyway",
    },
  }
}
