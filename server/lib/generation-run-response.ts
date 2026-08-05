/**
 * The single shape the generation-run endpoints return, so the client has one
 * type to consume and the GET/POST/DELETE routes cannot drift apart. The type
 * itself lives in `shared/` — see `#shared/utils/generation-run-contract`.
 */

import type { GenerationRunWire } from "#shared/utils/generation-run-contract"
import type { GenerationRunRecord, RunDayRecord, RunSummary } from "./generation-run"

export function serializeRun(
  run: GenerationRunRecord,
  remaining: RunDayRecord[],
  summary: RunSummary,
): GenerationRunWire {
  return {
    runId: run.id,
    mode: run.mode,
    // Reused verbatim on resume — the traveler already paid for this plan.
    outline: run.outline,
    days: run.days
      .toSorted((a, b) => a.dayNumber - b.dayNumber)
      .map((d) => ({
        dayId: d.dayId,
        dayNumber: d.dayNumber,
        status: d.status,
        attempts: d.attempts,
        lastError: d.lastError,
      })),
    remaining: remaining.map((d) => ({ dayId: d.dayId, dayNumber: d.dayNumber })),
    summary,
  }
}
