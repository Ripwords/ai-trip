/**
 * Wire contract for the full-itinerary generation run.
 *
 * Lives in `shared/` so the server route and the client composable import the
 * SAME types via `#shared` — the client never re-declares an API response
 * shape, and a change to one side fails to compile on the other.
 */

export type RunDayStatusWire = "pending" | "in_progress" | "succeeded" | "failed"
export type RunModeWire = "outline" | "generic"

export interface GenerationRunOutlineDayWire {
  dayId: string
  dayNumber: number
  theme: string
  focusArea: string
  mustInclude: string[]
  guidance: string
}

export interface GenerationRunOutlineWire {
  days: GenerationRunOutlineDayWire[]
  avoidRepeats: string[]
}

export interface GenerationRunDayWire {
  dayId: string
  dayNumber: number
  status: RunDayStatusWire
  attempts: number
  lastError: string | null
}

export interface GenerationRunSummaryWire {
  total: number
  generated: number
  failed: number
  remaining: number
  /** Credits this run has billed so far — outline plus every claimed day. */
  creditsCharged: number
}

export interface GenerationRunWire {
  runId: string
  mode: RunModeWire
  /** Null when the run has no trip-level plan; reused verbatim on resume. */
  outline: GenerationRunOutlineWire | null
  days: GenerationRunDayWire[]
  /** Days still to generate, in day order. Drive the loop from this. */
  remaining: { dayId: string; dayNumber: number }[]
  summary: GenerationRunSummaryWire
}

export interface AiUsageWire {
  used: number
  limit: number
  remaining: number
}

/** GET /api/trips/:id/generation-run */
export interface GenerationRunStateResponse {
  run: GenerationRunWire | null
  aiUsage: AiUsageWire
}

/** POST /api/trips/:id/generation-run */
export type GenerationRunStartResponse = GenerationRunWire & {
  /** True when an existing run was picked up — no credit was spent. */
  resumed: boolean
  aiUsage: AiUsageWire
}
