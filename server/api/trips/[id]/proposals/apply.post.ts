import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { itineraryDays, trips } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { normalizeTransportMode } from "../../../../utils/transport"
import { applyProposal, proposalSchema } from "../../../../lib/proposals"
import { recordProposalState } from "../../../../lib/trip-chat"

const bodySchema = z.object({
  proposal: proposalSchema,
  /**
   * The transcript row this proposal card belongs to, so the apply can be
   * recorded against it. Optional: the same proposal shape is applied from
   * places that have no chat row behind them, and a missing id must not fail
   * the itinerary write.
   */
  chatMessageId: z.string().uuid().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { proposal, chatMessageId } = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

  const day = await db.query.itineraryDays.findFirst({
    where: eq(itineraryDays.id, proposal.dayId),
  })
  if (!day || day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Day not found in this trip" })
  }

  const transportMode = normalizeTransportMode(trip.preferences?.transportMode)

  try {
    const result = await applyProposal(proposal, {
      tripId: id,
      dayId: proposal.dayId,
      userId: session.user.id,
      transportMode,
      currencyCode: trip.currencyCode || "USD",
      dayLocation: day.accommodationAddress ?? trip.destination,
      destinationCoords:
        day.accommodationLat != null && day.accommodationLng != null
          ? { lat: day.accommodationLat, lng: day.accommodationLng }
          : undefined,
    })
    // Record the decision on the transcript, AFTER the write, and read the
    // day's new version in the same breath. Two reasons this lives here rather
    // than in a follow-up call from the browser: the watermark must come from
    // the column it will later be compared against (a client wall clock cannot
    // be, and an inflated one would keep a superseded Undo enabled), and any
    // gap between the write and the read is a window in which a co-traveller's
    // edit gets absorbed into this proposal's watermark instead of superseding
    // it.
    //
    // `recordProposalState` never throws; the itinerary change has already
    // happened and reporting it as failed would be a lie. Losing the record
    // costs the card its Applied stamp on the next reload, nothing more.
    if (chatMessageId) {
      const dayNow = await db.query.itineraryDays.findFirst({
        where: eq(itineraryDays.id, proposal.dayId),
        columns: { updatedAt: true },
      })
      await recordProposalState({
        tripId: id,
        userId: session.user.id,
        messageId: chatMessageId,
        proposalId: proposal.id,
        state: "applied",
        dayVersion: dayNow?.updatedAt,
      })
    }

    return { success: true, ...result, undoAvailable: true }
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) {
      throw createError({ statusCode: 409, message: "Proposal is no longer applicable" })
    }
    throw e
  }
})
