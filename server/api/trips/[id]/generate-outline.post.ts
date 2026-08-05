import { uuidParamsSchema } from "../../../utils/schemas"
import { refundAiCredit } from "../../../utils/ai-limits"
import { getTripWithRelations } from "../../../lib/trips"
import type { TripOutline } from "../../../lib/trip-outline"
import {
  assertDistinctEmptyDayNumbers,
  buildOutlineForTrip,
} from "../../../lib/trip-outline-request"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await getTripWithRelations(id)
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  const hasEmptyDay = trip.days.some((d) => d.activities.length === 0)
  if (!hasEmptyDay) {
    // 400 BEFORE any credit spend — nothing to outline.
    throw createError({ statusCode: 400, message: "This trip has no empty days to plan." })
  }

  // Defense-in-depth: itinerary_days has no unique constraint on
  // (trip_id, day_number). Throws BEFORE any credit is spent.
  assertDistinctEmptyDayNumbers(trip)

  // Consume AFTER auth + access + existence + empty-day checks, so every throw
  // above never needs a refund. Every throw below is refunded exactly once by
  // the try/catch wrap.
  const usageMonth = await tryConsumeAiCredit(session.user.id)

  let outline: TripOutline
  try {
    outline = await buildOutlineForTrip(trip, session.user.id)

    await logTripAction({
      tripId: id,
      userId: session.user.id,
      action: "ai_outline",
      description: `AI outlined ${outline.days.length} day${outline.days.length === 1 ? "" : "s"}`,
      metadata: { dayNumbers: outline.days.map((d) => d.dayNumber) },
    })
  } catch (e) {
    // The outline produced nothing usable — the traveler keeps their credit.
    await refundAiCredit(session.user.id, usageMonth)
    throw e
  }

  // Placed AFTER the try/catch (not inside it, before logTripAction) on purpose:
  // if logTripAction threw, the catch above already refunds once, and doing it
  // again here would double-refund — refundAiCredit's GREATEST(count-1, 0) would
  // decrement twice and mint the user a free credit. A 200 with an empty outline
  // never entered the catch, so this is the only place it's safe to check.
  // The model returned no usable day — the traveler keeps their credit.
  if (outline.days.length === 0) await refundAiCredit(session.user.id, usageMonth)
  return { outline }
})
