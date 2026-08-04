import { z } from "zod"
import { reviewItinerary, type ReviewableFlight } from "../../../lib/itinerary-review"
import { reviewItineraryWithJudgment } from "../../../lib/itinerary-review-ai"
import { getTripFlightsForUser } from "../../../lib/trip-flights"
import { getTripWithRelations } from "../../../lib/trips"
import { uuidParamsSchema } from "../../../utils/schemas"
import { normalizeTransportMode } from "../../../utils/transport"
import { refundAiCredit } from "../../../utils/ai-limits"

const reviewRequestSchema = z
  .object({
    scope: z.enum(["day", "trip"]),
    dayId: z.string().uuid().optional(),
    /**
     * Opt-in AI judgment pass. Off by default on purpose: the review panel runs
     * this endpoint on mount and again on every scope/day change, so making the
     * model call unconditional would burn a credit and several seconds of
     * DeepSeek tool-calling every time the panel is opened.
     */
    judgment: z.boolean().optional().default(false),
  })
  .refine((value) => value.scope === "trip" || value.dayId, {
    message: "dayId is required when scope is day",
    path: ["dayId"],
  })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, reviewRequestSchema.parse)

  await requireTripAccess(id, session.user.id)

  const trip = await getTripWithRelations(id)
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Flight bounds enable arrival/departure-day findings. User-scoped; degrades
  // to no flight findings when unavailable.
  let flights: ReviewableFlight[] = []
  try {
    const rows = await getTripFlightsForUser({ tripId: id, userId: session.user.id })
    flights = rows.map((f) => ({
      departureAirport: f.departureAirport,
      arrivalAirport: f.arrivalAirport,
      departureTimeLocal: f.departureTimeLocal,
      arrivalTimeLocal: f.arrivalTimeLocal,
    }))
  } catch (e: unknown) {
    console.error("[review.post] Flight context unavailable, proceeding without:", e)
  }

  const reviewable = { ...trip, flights }

  if (!body.judgment) {
    try {
      return reviewItinerary(reviewable, body)
    } catch (error) {
      if (error instanceof Error && error.message === "Day not found") {
        throw createError({ statusCode: 404, message: "Day not found" })
      }
      throw error
    }
  }

  // The judgment pass needs an anchor day for the tool context. Prefer the
  // requested day; a trip-scope review anchors on the first day.
  const activeDayId = body.dayId ?? trip.days[0]?.id
  if (!activeDayId) {
    throw createError({ statusCode: 400, message: "This trip has no days to review yet." })
  }

  // Run the deterministic pass first so an invalid dayId 404s BEFORE a credit is
  // consumed — same ordering rule the other AI endpoints follow.
  try {
    reviewItinerary(reviewable, body)
  } catch (error) {
    if (error instanceof Error && error.message === "Day not found") {
      throw createError({ statusCode: 404, message: "Day not found" })
    }
    throw error
  }

  const usageMonth = await tryConsumeAiCredit(session.user.id)

  const result = await reviewItineraryWithJudgment(reviewable, body, {
    tripId: id,
    dayId: activeDayId,
    transportMode: normalizeTransportMode(trip.preferences?.transportMode),
    currencyCode: trip.currencyCode ?? "USD",
    // Without this the review tools cannot load the user's flights.
    userId: session.user.id,
  })

  // reviewItineraryWithJudgment degrades to deterministic-only rather than
  // throwing, so the refund hangs off its status flag: the traveler paid for the
  // judgment pass and did not get one.
  if (!result.judgment?.ran) {
    await refundAiCredit(session.user.id, usageMonth)
  }

  return result
})
