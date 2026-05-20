import { and, eq, asc } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { trips, itineraryDays, activities, tripIdeas } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import { processUserRequest } from "../../../../../lib/ai"
import { enrichItinerary } from "../../../../../lib/enrich"
import { computeAndSaveSegments } from "../../../../../lib/segments"
import { getDistanceMatrix } from "../../../../../lib/google-maps"
import { sanitizePromptInput } from "../../../../../utils/sanitize"
import { normalizeTransportMode } from "../../../../../utils/transport"
import { formatItineraryReviewMessage, reviewItinerary } from "../../../../../lib/itinerary-review"
import { getTripWithRelations } from "../../../../../lib/trips"

const aiBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
})

function isReviewPrompt(prompt: string): boolean {
  return /\b(review|audit|check|problem|problems|problematic|issue|issues|risk|risks|feasible|feasibility|realistic|workable|too much|too packed|too tight|conflict|conflicts|overlap|overlaps)\b/i.test(
    prompt,
  )
}

function getReviewScope(prompt: string): "day" | "trip" {
  if (
    /\b(whole trip|entire trip|full trip|all days|overall|trip as a whole)\b/i.test(prompt) ||
    /\btrip\b.*\b(review|problem|problems|issue|issues|risk|risks|feasible|realistic)\b/i.test(
      prompt,
    )
  ) {
    return "trip"
  }
  return "day"
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const body = await readValidatedBody(event, aiBodySchema.parse)

  // Atomically consume one AI credit (throws 429 if limit reached)
  await tryConsumeAiCredit(session.user.id)

  // Sanitize prompt
  const prompt = sanitizePromptInput(body.prompt)
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

  if (isReviewPrompt(prompt)) {
    const reviewTrip = await getTripWithRelations(id)
    if (!reviewTrip) {
      throw createError({ statusCode: 404, message: "Trip not found" })
    }

    const scope = getReviewScope(prompt)
    const review = reviewItinerary(reviewTrip, scope === "trip" ? { scope } : { scope, dayId })
    const message = formatItineraryReviewMessage(review)

    await logTripAction({
      tripId: id,
      userId: session.user.id,
      action: "ai_prompt",
      description: `AI review: ${message}`,
      metadata: {
        prompt: body.prompt,
        intent: "review",
        scope,
        findings: review.summary.totalFindings,
      },
    })

    return {
      success: true,
      added: 0,
      removed: 0,
      updated: 0,
      optimized: false,
      enrichmentFailures: 0,
      intent: "review",
      message,
      review,
    }
  }

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
      destination: dayLocation,
      tripDestination: trip.destination,
      tripId: id,
      dayId,
      transportMode,
      date: day.date,
      dayNumber: day.dayNumber,
      existingActivities: day.activities.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        suggestedTime: a.suggestedTime,
        estimatedDurationMinutes: a.estimatedDurationMinutes,
        address: a.address,
        lat: a.lat,
        lng: a.lng,
      })),
      accommodation: day.accommodationName
        ? { name: day.accommodationName, address: day.accommodationAddress }
        : undefined,
      startLocation: startLocation
        ? { name: startLocation.name, address: startLocation.address }
        : undefined,
      preferences: trip.preferences ?? undefined,
      otherDayActivities,
      tripNotes: trip.tripNotes,
      savedIdeas: savedIdeasRows,
    })
  } catch (e: unknown) {
    console.error("[ai.post] AI processing failed:", e)
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
    const existingNames = new Set(
      day.activities
        .filter(
          (a) =>
            !result.removals.some(
              (r) => r.name.toLowerCase().trim() === a.name.toLowerCase().trim(),
            ),
        )
        .map((a) => a.name.toLowerCase().trim()),
    )

    const deduped = result.newActivities.filter((a) => {
      const n = a.name.toLowerCase().trim()
      return (
        !existingNames.has(n) && ![...existingNames].some((e) => e.includes(n) || n.includes(e))
      )
    })

    console.log("[ai.post] After dedup:", {
      before: result.newActivities.length,
      after: deduped.length,
    })

    if (deduped.length > 0) {
      // Enrich with Google Maps (graceful — if enrichment fails, skip adding)
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
              suggestedTime: activity.suggestedTime,
              estimatedDurationMinutes: activity.estimatedDurationMinutes,
              costEstimate: activity.costEstimate.toString(),
              tags: activity.tags,
              sortOrder: maxSort + 1 + index,
            })),
          )
          addedCount = enrichedActivities.length
        }
      } catch (e: unknown) {
        console.error("[ai.post] Enrichment failed, skipping new activities:", e)
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

  // Handle AI-determined activity order (from optimize intent)
  if (result.orderedActivities?.length) {
    const currentActivities = await db.query.activities.findMany({
      where: eq(activities.itineraryDayId, dayId),
      orderBy: [asc(activities.sortOrder)],
    })

    await Promise.all(
      result.orderedActivities.map(async (ordered, i) => {
        const match = currentActivities.find(
          (a) => a.name.toLowerCase().trim() === ordered.name.toLowerCase().trim(),
        )
        if (match) {
          await db
            .update(activities)
            .set({ sortOrder: i, suggestedTime: ordered.suggestedTime })
            .where(eq(activities.id, match.id))
        }
      }),
    )
    optimized = true
  }

  // Handle route optimization
  if (result.shouldOptimize && !result.orderedActivities?.length) {
    const allDayActivities = await db.query.activities.findMany({
      where: eq(activities.itineraryDayId, dayId),
      orderBy: [asc(activities.sortOrder)],
    })

    if (allDayActivities.length >= 2) {
      // Get travel times
      const geoActivities = allDayActivities.filter((a) => a.lat != null && a.lng != null)
      const travelTimes: { fromId: string; toId: string; durationMinutes: number }[] = []

      if (geoActivities.length >= 2) {
        try {
          const origins = geoActivities.slice(0, -1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
          const destinations = geoActivities.slice(1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
          const matrix = await getDistanceMatrix(origins, destinations, transportMode)
          for (let i = 0; i < origins.length; i++) {
            const element = matrix[i]?.[i]
            if (element?.duration?.value) {
              travelTimes.push({
                fromId: geoActivities[i]!.id,
                toId: geoActivities[i + 1]!.id,
                durationMinutes: Math.ceil(element.duration.value / 60),
              })
            }
          }
        } catch {
          /* proceed without travel times */
        }
      }

      // Compute schedule
      const dayDate = day.date
      let startHour = 9
      let startMinute = 0
      let startTravelTimeMinutes = 0
      const times = allDayActivities
        .map((a) => a.suggestedTime)
        .filter((t): t is string => !!t)
        .map((t) => {
          const m = t.match(/^(\d{1,2}):(\d{2})/)
          return m ? parseInt(m[1]!) * 60 + parseInt(m[2]!) : null
        })
        .filter((m): m is number => m !== null)
      const earliestActivityMinutes = times.length > 0 ? Math.min(...times) : null
      if (earliestActivityMinutes != null) {
        startHour = Math.floor(earliestActivityMinutes / 60)
        startMinute = earliestActivityMinutes % 60
      }

      const firstActivity = allDayActivities.find((a) => a.lat != null && a.lng != null)
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
        activities: allDayActivities.map((a) => ({
          id: a.id,
          name: a.name,
          estimatedDurationMinutes: a.estimatedDurationMinutes,
          lat: a.lat,
          lng: a.lng,
          openingMinutes: parseOpeningTime(a.openingHours, dayDate),
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

  // Recompute segments
  await computeAndSaveSegments(dayId, transportMode)

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_prompt",
    description: `AI ${result.intent}: ${result.message}`,
    metadata: {
      prompt: body.prompt,
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
