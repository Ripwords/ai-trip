/**
 * Decides how a "Generate full itinerary" run should spend AI credits.
 *
 * A fresh run costs N+1 prompts (1 trip-level plan + 1 per day). When the
 * traveler doesn't have that many left, planning is skipped rather than burning
 * a scarce credit on it, and days fall back to the generic prompt.
 *
 * RESUMING a run costs N, not N+1: the outline is stored on the run and reused,
 * so it is never bought twice. `outlineAlreadyPaid` switches the arithmetic and
 * the copy — quoting N+1 on a resume would be a lie about what is charged.
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

export interface GenerationPlanOptions {
  /**
   * True when an existing run already holds a paid-for outline. The outline
   * credit is not charged again, so it is not quoted again either.
   */
  outlineAlreadyPaid?: boolean
}

export function planGenerationRun(
  emptyDayCount: number,
  aiRemaining?: number,
  options: GenerationPlanOptions = {},
): GenerationPlan {
  // Normalize inputs to ensure non-negative integers. Non-finite values are
  // treated as missing/unknown to prevent broken iteration counts and messages.
  const normalizedDayCount = Number.isFinite(emptyDayCount)
    ? Math.max(0, Math.floor(emptyDayCount))
    : 0

  if (normalizedDayCount === 0) return { mode: "none" }

  let normalizedAiRemaining = aiRemaining
  if (normalizedAiRemaining !== undefined) {
    if (!Number.isFinite(normalizedAiRemaining)) {
      normalizedAiRemaining = undefined
    } else {
      normalizedAiRemaining = Math.max(0, Math.floor(normalizedAiRemaining))
    }
  }

  const resuming = options.outlineAlreadyPaid === true
  const dayWord = normalizedDayCount === 1 ? "day" : "days"
  // Cost of going ahead: the day prompts, plus the outline only when it still
  // has to be bought.
  const totalCost = normalizedDayCount + (resuming ? 0 : 1)

  if (normalizedAiRemaining == null || normalizedAiRemaining >= totalCost) {
    return {
      mode: "outline",
      dayCount: normalizedDayCount,
      confirm: resuming
        ? {
            title: "Resume generating itinerary",
            message: `Picking up where this trip left off — the trip-level plan is already paid for and will be reused. ${normalizedDayCount} ${dayWord} left to fill. Uses ${normalizedDayCount} AI prompt${normalizedDayCount === 1 ? "" : "s"} (1 per day).`,
            confirmText: "Resume",
          }
        : {
            title: "Generate full itinerary",
            message: `AI will plan your ${normalizedDayCount} empty ${dayWord} together — themes, areas, and pacing — then fill each one. Uses ${totalCost} AI prompts (1 to plan the trip, 1 per day).`,
            confirmText: "Generate",
          },
    }
  }

  // normalizedAiRemaining === 0 still attempts one day so the server's 429 surfaces to
  // the user as an error instead of the run silently doing nothing.
  const dayCount =
    normalizedAiRemaining === 0 ? 1 : Math.min(normalizedAiRemaining, normalizedDayCount)

  return {
    mode: "generic",
    dayCount,
    confirm: {
      title: "Not enough AI prompts",
      message: resuming
        ? `Finishing the remaining ${normalizedDayCount} more days needs ${totalCost} prompts (1 per day) but you have ${normalizedAiRemaining} left this month. Fill ${dayCount} ${dayCount === 1 ? "day" : "days"} now instead?`
        : `Planning the whole trip needs ${totalCost} prompts (1 to plan, 1 per day) but you have ${normalizedAiRemaining} left this month. Skip trip-level planning and fill ${dayCount} ${dayCount === 1 ? "day" : "days"} instead?`,
      confirmText: "Continue anyway",
    },
  }
}
