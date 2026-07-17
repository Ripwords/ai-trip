import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { tripIdeas } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { refundAiCredit } from "../../../utils/ai-limits"
import { getTripWithRelations } from "../../../lib/trips"
import { getTripFlightsForUser } from "../../../lib/trip-flights"
import { buildTripOutline, type TripOutlineInput } from "../../../lib/trip-outline"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await getTripWithRelations(id)
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  const sortedDays = trip.days.toSorted((a, b) => a.dayNumber - b.dayNumber)
  const hasEmptyDay = sortedDays.some((d) => d.activities.length === 0)
  if (!hasEmptyDay) {
    // 400 BEFORE any credit spend — nothing to outline.
    throw createError({ statusCode: 400, message: "This trip has no empty days to plan." })
  }

  // Defense-in-depth: itinerary_days has no unique constraint on (trip_id, day_number)
  // — only a non-unique index. buildTripOutline keys its empty-day lookup Map by
  // dayNumber, so two empty days sharing a dayNumber would silently collapse to one
  // dayId and send that day's plan to the wrong day (or drop a day's plan entirely).
  // This should never happen given how days are numbered on write, but if it ever
  // does, fail loudly BEFORE spending a credit rather than risk a misdirected outline.
  const emptyDayNumbers = sortedDays
    .filter((d) => d.activities.length === 0)
    .map((d) => d.dayNumber)
  if (new Set(emptyDayNumbers).size !== emptyDayNumbers.length) {
    throw createError({
      statusCode: 500,
      message: "This trip's days are in an inconsistent state. Please contact support.",
    })
  }

  // Consume AFTER auth + access + existence + empty-day checks, so every throw
  // above never needs a refund. Every throw below is refunded exactly once by
  // the try/catch wrap.
  await tryConsumeAiCredit(session.user.id)

  try {
    const savedIdeas = await db.query.tripIdeas.findMany({
      where: eq(tripIdeas.tripId, id),
      columns: { name: true, type: true, description: true },
    })

    const flights = await getTripFlightsForUser({ tripId: id, userId: session.user.id })

    const input: TripOutlineInput = {
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      preferences: trip.preferences ?? undefined,
      tripNotes: trip.tripNotes,
      savedIdeas,
      days: sortedDays.map((d) => ({
        dayId: d.id,
        dayNumber: d.dayNumber,
        date: d.date,
        isEmpty: d.activities.length === 0,
        existingActivityNames: d.activities.map((a) => a.name),
      })),
      flights: flights.map((f) => ({
        departureAirport: f.departureAirport,
        arrivalAirport: f.arrivalAirport,
        departureTime: f.departureTime?.toISOString() ?? null,
        arrivalTime: f.arrivalTime?.toISOString() ?? null,
      })),
    }

    const outline = await buildTripOutline(input)

    await logTripAction({
      tripId: id,
      userId: session.user.id,
      action: "ai_outline",
      description: `AI outlined ${outline.days.length} day${outline.days.length === 1 ? "" : "s"}`,
      metadata: { dayNumbers: outline.days.map((d) => d.dayNumber) },
    })

    return { outline }
  } catch (e) {
    // The outline produced nothing usable — the traveler keeps their credit.
    await refundAiCredit(session.user.id)
    throw e
  }
})
