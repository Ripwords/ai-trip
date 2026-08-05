import { uuidParamsSchema } from "../../../utils/schemas"
import { generationRunStore } from "../../../lib/generation-run-store"

/**
 * Abandon the trip's active run.
 *
 * Refunds nothing: the outline and every claimed day were real model calls. All
 * this does is free the trip's active-run slot so the next "Generate" starts
 * fresh instead of resuming a plan the traveler no longer wants.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const run = await generationRunStore.findActiveRun(id)
  if (!run) return { cancelled: false }

  await generationRunStore.finishRun(run.id, "cancelled")
  return { cancelled: true, runId: run.id }
})
