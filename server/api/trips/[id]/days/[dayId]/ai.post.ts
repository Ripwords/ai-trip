import { and, eq, asc } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { trips, itineraryDays, activities, tripIdeas } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import { processUserRequest, type FlightPromptInput } from "../../../../../lib/ai"
import { getTripFlightsForUser } from "../../../../../lib/trip-flights"
import { enrichItinerary } from "../../../../../lib/enrich"
import { computeAndSaveSegments } from "../../../../../lib/segments"
import { getDistanceMatrix } from "../../../../../lib/google-maps"
import { consecutiveTravelTimes } from "../../../../../lib/travel-times"
import { sanitizePromptInput } from "../../../../../utils/sanitize"
import { normalizeTransportMode } from "../../../../../utils/transport"
import { guardCostEstimate } from "../../../../../lib/cost-guard"
import { filterDuplicateActivities } from "../../../../../utils/activity-dedup"
import { refundAiCredit } from "../../../../../utils/ai-limits"
import {
  normalizeSuggestedTime,
  clampDurationMinutes,
} from "../../../../../lib/normalize-ai-output"

const aiBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  intent: z.enum([
    "add",
    "remove",
    "modify",
    "optimize",
    "reschedule",
    "fill_gaps",
    "accommodation",
  ]),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const { prompt: rawPrompt, intent } = await readValidatedBody(event, aiBodySchema.parse)

  // Sanitize before consuming: this is pure string validation, so a rejection
  // here must never cost the traveler a credit. (Phase 3 added a refund here
  // because the consume used to come first; moving the consume below every
  // validation makes that refund unnecessary rather than merely correct.)
  const prompt = sanitizePromptInput(rawPrompt)
  if (!prompt) {
    throw createError({
      statusCode: 400,
      message:
        "Your prompt contains disallowed content. Please describe your travel preferences only.",
    })
  }

  // Verify trip access (owner or editor can use AI)
  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Get the day with activities
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
    with: {
      activities: {
        orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
      },
    },
  })

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  // Atomically consume one AI credit (throws 429 if limit reached). Kept last
  // among the rejections that can be known without calling the model, so a
  // 403/404 never burns a credit.
  await tryConsumeAiCredit(session.user.id)

  // Fetch saved ideas for AI context
  const savedIdeasRows = await db.query.tripIdeas.findMany({
    where: eq(tripIdeas.tripId, id),
    columns: { name: true, type: true, description: true },
  })

  // Collect activities from OTHER days to avoid cross-day duplicates (especially restaurants)
  const allTripDays = await db.query.itineraryDays.findMany({
    where: eq(itineraryDays.tripId, id),
    with: {
      activities: { columns: { name: true, type: true } },
    },
  })
  const transportMode = normalizeTransportMode(trip.preferences?.transportMode)
  const otherDayActivities = allTripDays
    .filter((d) => d.id !== dayId)
    .flatMap((d) => d.activities.map((a) => ({ name: a.name, type: a.type })))

  const previousStayDay = allTripDays
    .filter((d) => d.dayNumber < day.dayNumber && d.accommodationName)
    .toSorted((a, b) => b.dayNumber - a.dayNumber)[0]
  const startLocation = previousStayDay?.accommodationName
    ? {
        name: previousStayDay.accommodationName,
        address: previousStayDay.accommodationAddress,
        lat: previousStayDay.accommodationLat,
        lng: previousStayDay.accommodationLng,
      }
    : null

  // Flight context — landing/departure times shape what fits on this day.
  // Degrades to "no flights" on failure rather than blocking the request.
  let flights: FlightPromptInput[] = []
  try {
    const flightRows = await getTripFlightsForUser({ tripId: id, userId: session.user.id })
    flights = flightRows.map((f) => ({
      departureAirport: f.departureAirport,
      arrivalAirport: f.arrivalAirport,
      departureTimeUtc: f.departureTime?.toISOString() ?? null,
      arrivalTimeUtc: f.arrivalTime?.toISOString() ?? null,
      departureTimeLocal: f.departureTimeLocal,
      arrivalTimeLocal: f.arrivalTimeLocal,
    }))
  } catch (e: unknown) {
    console.error("[ai.post] Flight context unavailable, proceeding without:", e)
  }

  // Derive day location from activities/accommodation
  let dayLocation = trip.destination
  const addresses = day.activities.map((a) => a.address).filter((a): a is string => !!a)
  if (addresses.length > 0) {
    dayLocation = `${addresses[0]} (near ${trip.destination})`
  }
  if (day.accommodationAddress) {
    dayLocation = `${day.accommodationAddress} (near ${trip.destination})`
  }

  // Process the user's request through the AI
  let result
  try {
    result = await processUserRequest({
      prompt,
      intent,
      destination: dayLocation,
      tripDestination: trip.destination,
      tripId: id,
      dayId,
      transportMode,
      date: day.date,
      dayNumber: day.dayNumber,
      currencyCode: trip.currencyCode || "USD",
      existingActivities: day.activities.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        suggestedTime: a.suggestedTime,
        estimatedDurationMinutes: a.estimatedDurationMinutes,
        address: a.address,
        lat: a.lat,
        lng: a.lng,
        openingHours: a.openingHours,
      })),
      accommodation: day.accommodationName
        ? {
            name: day.accommodationName,
            address: day.accommodationAddress,
            lat: day.accommodationLat,
            lng: day.accommodationLng,
          }
        : undefined,
      startLocation: startLocation
        ? { name: startLocation.name, address: startLocation.address }
        : undefined,
      preferences: trip.preferences ?? undefined,
      otherDayActivities,
      tripNotes: trip.tripNotes,
      savedIdeas: savedIdeasRows,
      flights,
    })
  } catch (e: unknown) {
    console.error("[ai.post] AI processing failed:", e)
    await refundAiCredit(session.user.id)
    throw createError({
      statusCode: 502,
      message: "AI service is temporarily unavailable. Please try again.",
    })
  }

  console.log("[ai.post] AI result:", {
    intent: result.intent,
    newActivities: result.newActivities.length,
    removals: result.removals.length,
    updates: result.updates.length,
    shouldOptimize: result.shouldOptimize,
  })

  let addedCount = 0
  let removedCount = 0
  let updatedCount = 0
  let optimized = false
  let enrichmentFailures = 0

  // Handle removals
  if (result.removals.length > 0) {
    await Promise.all(
      result.removals.map(async (removal) => {
        const match = day.activities.find(
          (a) => a.name.toLowerCase().trim() === removal.name.toLowerCase().trim(),
        )
        if (match) {
          await db.delete(activities).where(eq(activities.id, match.id))
          removedCount++
        }
      }),
    )
  }

  // Handle time/duration updates
  if (result.updates.length > 0) {
    const isReschedule = result.intent === "reschedule"
    await Promise.all(
      result.updates.map(async (update) => {
        const match = day.activities.find(
          (a) => a.name.toLowerCase().trim() === update.name.toLowerCase().trim(),
        )
        if (!match) return

        // For reschedule: always overwrite times. For other intents: only fill blanks.
        if (isReschedule) {
          await db
            .update(activities)
            .set({
              suggestedTime: update.suggestedTime,
              estimatedDurationMinutes: update.estimatedDurationMinutes,
            })
            .where(eq(activities.id, match.id))
          updatedCount++
        } else if (!match.suggestedTime || !match.estimatedDurationMinutes) {
          const setFields: Record<string, unknown> = {}
          if (!match.suggestedTime) setFields.suggestedTime = update.suggestedTime
          if (!match.estimatedDurationMinutes)
            setFields.estimatedDurationMinutes = update.estimatedDurationMinutes
          if (Object.keys(setFields).length > 0) {
            await db.update(activities).set(setFields).where(eq(activities.id, match.id))
            updatedCount++
          }
        }
      }),
    )
  }

  // Handle new activities
  if (result.newActivities.length > 0) {
    // Dedup against existing names
    const stillOnDay = day.activities.filter(
      (a) =>
        !result.removals.some((r) => r.name.toLowerCase().trim() === a.name.toLowerCase().trim()),
    )
    // Exact normalized-name match. Substring matching dropped any suggestion
    // whose name was a substring of an existing one, or vice versa.
    const { fresh: deduped } = filterDuplicateActivities(result.newActivities, stillOnDay)

    console.log("[ai.post] After dedup:", {
      before: result.newActivities.length,
      after: deduped.length,
    })

    if (deduped.length > 0) {
      // Enrichment is the last step that can fail after the credit is spent.
      // A failure here used to be swallowed, returning `success: true, added: 0`
      // over an untouched day: the traveler was charged, the page reported
      // success, and the full-itinerary loop counted the day as generated.
      // Mirrors applyProposal's add-activities branch, which already re-throws.
      let enriched
      try {
        // Use first geo-located activity or accommodation as location bias for place search
        const geoActivity = day.activities.find((a) => a.lat != null && a.lng != null)
        const destinationCoords = geoActivity
          ? { lat: geoActivity.lat!, lng: geoActivity.lng! }
          : undefined

        enriched = await enrichItinerary(
          { days: [{ dayNumber: day.dayNumber, theme: "", activities: deduped }] },
          dayLocation,
          destinationCoords,
        )

        enrichmentFailures = enriched.enrichmentFailures
        const enrichedActivities = enriched.days[0]?.activities ?? []
        console.log("[ai.post] After enrich:", {
          count: enrichedActivities.length,
          failures: enrichmentFailures,
        })

        if (enrichedActivities.length > 0) {
          const currentActivities = await db.query.activities.findMany({
            where: eq(activities.itineraryDayId, dayId),
            orderBy: [asc(activities.sortOrder)],
          })
          const maxSort =
            currentActivities.length > 0
              ? Math.max(...currentActivities.map((a) => a.sortOrder))
              : -1

          const guardedCosts = await Promise.all(
            enrichedActivities.map((a) =>
              guardCostEstimate({
                costEstimate: a.costEstimate,
                type: a.type,
                placeId: a.placeId,
                currencyCode: trip.currencyCode || "USD",
              }),
            ),
          )

          await db.insert(activities).values(
            enrichedActivities.map((activity, index) => ({
              itineraryDayId: dayId,
              name: activity.name,
              placeId: activity.placeId,
              type: activity.type,
              description: activity.description,
              lat: activity.lat,
              lng: activity.lng,
              address: activity.address,
              rating: activity.rating?.toString() ?? null,
              priceLevel: activity.priceLevel,
              openingHours: activity.openingHours,
              photos: activity.photos,
              suggestedTime: normalizeSuggestedTime(activity.suggestedTime),
              estimatedDurationMinutes:
                clampDurationMinutes(activity.estimatedDurationMinutes) ??
                activity.estimatedDurationMinutes,
              costEstimate: guardedCosts[index] ?? null,
              tags: activity.tags,
              sortOrder: maxSort + 1 + index,
            })),
          )
          addedCount = enrichedActivities.length
        }
      } catch (e: unknown) {
        console.error("[ai.post] Enrichment failed:", e)
        // Only bail when the request achieved nothing at all. `modify` removes
        // activities before this point and `fill_gaps` can fill blank times —
        // that work is already committed, so throwing would strand the day in a
        // half-applied state AND refund a request that did change something.
        // In that case fall through and report the partial result instead.
        if (addedCount === 0 && removedCount === 0 && updatedCount === 0) {
          await refundAiCredit(session.user.id)
          throw createError({
            statusCode: 502,
            message: "Couldn't look those places up on Google Maps. Please try again.",
          })
        }
      }
    }
  }

  // Handle accommodation booking
  if (result.accommodation) {
    await db
      .update(itineraryDays)
      .set({
        accommodationName: result.accommodation.name,
        accommodationAddress: result.accommodation.address,
        accommodationLat: result.accommodation.lat,
        accommodationLng: result.accommodation.lng,
        accommodationPlaceId: result.accommodation.placeId,
      })
      .where(eq(itineraryDays.id, dayId))
  }

  // Recompute a coherent schedule whenever the AI changed the day. One pass
  // covers both shapes: `orderedActivities` (optimize) supplies an explicit
  // visit order plus intended times, matched by activity id; add/modify/
  // fill_gaps just need the day re-sorted by time-of-day (new activities were
  // appended at the end of sortOrder regardless of their times). computeSchedule
  // then resolves overlaps and travel gaps WITHOUT pulling activities away from
  // their intended slots — a 19:30 dinner stays an evening dinner.
  if (result.shouldOptimize || result.orderedActivities?.length) {
    const allDayActivities = await db.query.activities.findMany({
      where: eq(activities.itineraryDayId, dayId),
      orderBy: [asc(activities.sortOrder)],
    })

    if (allDayActivities.length >= 2) {
      const aiTimeById = new Map(
        (result.orderedActivities ?? []).map((o) => [o.id, o.suggestedTime]),
      )
      const merged = allDayActivities.map((a) => ({
        ...a,
        suggestedTime: aiTimeById.get(a.id) ?? a.suggestedTime,
      }))
      const ordered = orderDayActivities(
        merged,
        result.orderedActivities?.map((o) => o.id),
      )

      // Per-pair travel times — bills N-1 Distance Matrix elements instead of the
      // (N-1)² a full matrix would, and caches per pair. See consecutiveTravelTimes.
      const travelTimes = await consecutiveTravelTimes(ordered, getDistanceMatrix, transportMode)

      // Compute schedule
      let startHour = 9
      let startMinute = 0
      let startTravelTimeMinutes = 0
      const intendedTimes = ordered
        .map((a) => parseClockMinutes(a.suggestedTime))
        .filter((m): m is number => m !== null)
      const earliestActivityMinutes = intendedTimes.length > 0 ? Math.min(...intendedTimes) : null
      if (earliestActivityMinutes != null) {
        startHour = Math.floor(earliestActivityMinutes / 60)
        startMinute = earliestActivityMinutes % 60
      }

      const firstActivity = ordered.find((a) => a.lat != null && a.lng != null)
      if (startLocation?.lat != null && startLocation.lng != null && firstActivity) {
        try {
          const matrix = await getDistanceMatrix(
            [{ lat: startLocation.lat, lng: startLocation.lng }],
            [{ lat: firstActivity.lat!, lng: firstActivity.lng! }],
            transportMode,
          )
          const duration = matrix[0]?.[0]?.duration?.value
          if (duration) startTravelTimeMinutes = Math.ceil(duration / 60)
        } catch {
          /* proceed without start travel time */
        }
      }

      if (earliestActivityMinutes != null && startTravelTimeMinutes > 0) {
        const departureMinutes = Math.max(7 * 60, earliestActivityMinutes - startTravelTimeMinutes)
        startHour = Math.floor(departureMinutes / 60)
        startMinute = departureMinutes % 60
      }

      const schedule = computeSchedule({
        activities: ordered.map((a) => ({
          id: a.id,
          name: a.name,
          estimatedDurationMinutes: a.estimatedDurationMinutes,
          lat: a.lat,
          lng: a.lng,
          openingMinutes: parseOpeningTime(a.openingHours, day.date),
          preferredMinutes: parseClockMinutes(a.suggestedTime),
        })),
        travelTimes,
        startHour,
        startMinute,
        startTravelTimeMinutes,
        bufferMinutes: 15,
      })

      await Promise.all(
        schedule.map((s) =>
          db
            .update(activities)
            .set({ sortOrder: s.sortOrder, suggestedTime: s.suggestedTime })
            .where(eq(activities.id, s.id)),
        ),
      )
      optimized = true
    }
  }

  // Reschedule rewrites times without reordering rows — keep the display order
  // (sortOrder) in sync with the new times so the day reads top-to-bottom.
  if (result.intent === "reschedule" && updatedCount > 0) {
    const currentActivities = await db.query.activities.findMany({
      where: eq(activities.itineraryDayId, dayId),
      orderBy: [asc(activities.sortOrder)],
    })
    const ordered = orderDayActivities(currentActivities)
    await Promise.all(
      ordered.flatMap((a, i) =>
        a.sortOrder === i
          ? []
          : [db.update(activities).set({ sortOrder: i }).where(eq(activities.id, a.id))],
      ),
    )
  }

  // Recompute segments
  await computeAndSaveSegments(dayId, transportMode)

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_prompt",
    description: `AI ${result.intent}: ${result.message}`,
    metadata: {
      prompt,
      intent: result.intent,
      added: addedCount,
      removed: removedCount,
    },
  })

  return {
    success: true,
    added: addedCount,
    removed: removedCount,
    updated: updatedCount,
    optimized,
    enrichmentFailures,
    intent: result.intent,
    message: result.message,
  }
})
