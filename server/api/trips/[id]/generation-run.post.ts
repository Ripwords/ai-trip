import "zod/compile"
import { z } from "zod"
import type { GenerationRunStartResponse } from "#shared/utils/generation-run-contract"
import { uuidParamsSchema } from "../../../utils/schemas"
import { getAiUsage, refundAiCredit } from "../../../utils/ai-limits"
import { getTripWithRelations } from "../../../lib/trips"
import {
  remainingRunDays,
  startOrResumeRun,
  summarizeRun,
  type TripDaySnapshot,
} from "../../../lib/generation-run"
import { generationRunStore } from "../../../lib/generation-run-store"
import {
  assertDistinctEmptyDayNumbers,
  buildOutlineForTrip,
} from "../../../lib/trip-outline-request"
import { serializeRun } from "../../../lib/generation-run-response"

/**
 * Start — or pick up — the trip's full-itinerary generation run.
 *
 * Idempotent by design. If the trip already has a run with work left, this
 * returns it: no credit is consumed and the outline model is not called again.
 * Only a trip with no live run pays the one outline credit.
 */
const bodySchema = z.object({
  /**
   * Start without buying a trip-level plan. The client sets this when the
   * traveler's remaining credits can't cover the outline plus every day.
   */
  skipOutline: z.boolean().optional(),
})

export default defineEventHandler(async (event): Promise<GenerationRunStartResponse> => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { skipOutline } = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await getTripWithRelations(id)
  if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

  const snapshot: TripDaySnapshot[] = trip.days.map((d) => ({
    dayId: d.id,
    dayNumber: d.dayNumber,
    activityCount: d.activities.length,
  }))
  const emptyDays = snapshot
    .filter((d) => d.activityCount === 0)
    .toSorted((a, b) => a.dayNumber - b.dayNumber)
    .map((d) => ({ dayId: d.dayId, dayNumber: d.dayNumber }))

  const now = new Date()
  const active = await generationRunStore.findActiveRun(id)
  const activeRemaining = active ? remainingRunDays(active, snapshot, now) : []

  // Nothing to do at all: retire a spent run rather than leaving it holding the
  // trip's single active-run slot, and reject BEFORE any credit is consumed.
  if (activeRemaining.length === 0 && emptyDays.length === 0) {
    if (active) await generationRunStore.finishRun(active.id, "completed")
    throw createError({ statusCode: 400, message: "This trip has no empty days to plan." })
  }

  // Only matters when a fresh outline is about to be built; throws before spend.
  if (activeRemaining.length === 0 && !skipOutline) assertDistinctEmptyDayNumbers(trip)

  // The refund has to reverse the month the outline credit was actually
  // attributed to, not "now" — a run started at 23:59 on the last of the month
  // that fails a second later must not credit the next month's bucket. The
  // consume hands back that month; hold it for the refund closure.
  let outlineUsageMonth: string | null = null

  const result = await startOrResumeRun({
    store: generationRunStore,
    tripId: id,
    userId: session.user.id,
    emptyDays,
    snapshot,
    now,
    buildOutline: () => buildOutlineForTrip(trip, session.user.id),
    consumeCredit: async () => {
      outlineUsageMonth = await tryConsumeAiCredit(session.user.id)
    },
    refundCredit: async () => {
      // A run that skipped the outline never consumed, so there is nothing to
      // reverse — refundAiCredit is GREATEST(count - 1, 0) and would otherwise
      // mint the traveler a credit they never spent.
      if (!outlineUsageMonth) return
      await refundAiCredit(session.user.id, outlineUsageMonth)
    },
    skipOutline,
  })

  if (!result.resumed) {
    await logTripAction({
      tripId: id,
      userId: session.user.id,
      action: "ai_outline",
      description:
        result.run.mode === "outline"
          ? `AI outlined ${result.run.outline?.days.length ?? 0} day${result.run.outline?.days.length === 1 ? "" : "s"}`
          : "Started full-itinerary generation without a trip-level plan",
      metadata: { runId: result.run.id, dayCount: result.remaining.length },
    })
  }

  return {
    ...serializeRun(result.run, result.remaining, summarizeRun(result.run, snapshot, now)),
    resumed: result.resumed,
    aiUsage: await getAiUsage(session.user.id),
  }
})
