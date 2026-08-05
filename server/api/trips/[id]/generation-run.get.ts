import type { GenerationRunStateResponse } from "#shared/utils/generation-run-contract"
import { uuidParamsSchema } from "../../../utils/schemas"
import { getAiUsage } from "../../../utils/ai-limits"
import { remainingRunDays, summarizeRun } from "../../../lib/generation-run"
import { generationRunStore, getTripDaySnapshot } from "../../../lib/generation-run-store"
import { serializeRun } from "../../../lib/generation-run-response"

/**
 * The trip's live generation run, or null. Costs nothing — a reopened tab calls
 * this to find out whether there is a run worth resuming before showing the
 * traveler a confirm dialog about spending credits.
 */
export default defineEventHandler(async (event): Promise<GenerationRunStateResponse> => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor", "viewer"])

  const run = await generationRunStore.findActiveRun(id)
  if (!run) return { run: null, aiUsage: await getAiUsage(session.user.id) }

  const snapshot = await getTripDaySnapshot(id)
  const now = new Date()
  return {
    run: serializeRun(run, remainingRunDays(run, snapshot, now), summarizeRun(run, snapshot, now)),
    aiUsage: await getAiUsage(session.user.id),
  }
})
