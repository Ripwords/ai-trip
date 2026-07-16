import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { itineraryDays, trips } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { normalizeTransportMode } from "../../../../utils/transport"
import { applyProposal, proposalSchema } from "../../../../lib/proposals"

const bodySchema = z.object({
  proposal: proposalSchema,
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const { proposal } = await readValidatedBody(event, bodySchema.parse)

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
    return { success: true, ...result, undoAvailable: true }
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) {
      throw createError({ statusCode: 409, message: "Proposal is no longer applicable" })
    }
    throw e
  }
})
