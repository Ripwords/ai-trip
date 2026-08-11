import { and, eq, asc } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { trips, itineraryDays, activities, tripIdeas } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import {
  processUserRequest,
  resolveStayContext,
  type FlightPromptInput,
} from "../../../../../lib/ai"
import { getTripFlightsForUser } from "../../../../../lib/trip-flights"
import { loadPartySize } from "../../../../../lib/trips"
import { enrichItinerary, partitionGeocoded } from "../../../../../lib/enrich"
import { computeAndSaveSegments } from "../../../../../lib/segments"
import { lockTripForStayWrite, reconcileTripStays } from "../../../../../lib/booking-sync"
import { getDistanceMatrix } from "../../../../../lib/google-maps"
import { consecutiveTravelTimes } from "../../../../../lib/travel-times"
import { sanitizePromptInput } from "../../../../../utils/sanitize"
import { countryByAlpha2 } from "~/data/countries"
import { normalizeTransportMode } from "../../../../../utils/transport"
import { guardCostEstimate } from "../../../../../lib/cost-guard"
import { filterDuplicateActivities } from "../../../../../utils/activity-dedup"
import { refundAiCredit, chargeExtraAiCredits, getAiUsage } from "../../../../../utils/ai-limits"
import { thinkingAvailable } from "../../../../../lib/ai-config"
import {
  THINKING_CREDIT_MULTIPLIER,
  chargedSoFar,
  canAffordThinking,
  GENERATION_MODEL_BUDGET_MS,
} from "../../../../../utils/ai-credit-cost"
import { withTimeout } from "../../../../../lib/retry"
import { beginRunDay, endRunDay } from "../../../../../lib/generation-run"
import { generationRunStore } from "../../../../../lib/generation-run-store"
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
  /**
   * Set by the full-itinerary flow. Binds this call to one day of a durable
   * generation run so a resumed run never charges twice for the same day.
   */
  runId: z.string().uuid().optional(),
  /**
   * Traveler opted into deeper reasoning for this request. Untrusted: the
   * handler ANDs it with thinkingAvailable() before it can affect the model
   * OR the price. Defaults false so the full-itinerary loop — which generates
   * every day and would otherwise cost 3x per day — is never silently upgraded.
   */
  thinking: z.boolean().optional().default(false),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const {
    prompt: rawPrompt,
    intent,
    runId,
    thinking: thinkingRequested,
  } = await readValidatedBody(event, aiBodySchema.parse)

  // Resolve ONCE, here, and use this everywhere below. A request that asks for
  // thinking while the Gemini fallback is active would otherwise be charged 3x
  // for a call that provably never reasoned.
  let thinking = thinkingRequested && thinkingAvailable()
  if (thinking) {
    // tryConsumeAiCredit gates on ONE credit, and the remaining
    // THINKING_CREDIT_MULTIPLIER-1 are charged afterwards with no limit check —
    // so a traveler at 99/100 could finish a thinking generation at 102/100.
    // Check the full price up front instead. Only read the ledger when thinking
    // was actually requested; the normal path should not pay for this query.
    const { remaining } = await getAiUsage(session.user.id)
    if (!canAffordThinking(remaining, THINKING_CREDIT_MULTIPLIER)) {
      // Downgrade rather than 429: the traveler still gets their itinerary, at
      // the normal price. Refusing outright would spend their last credits on
      // an error instead of a day plan.
      console.info(
        "[ai.post] thinking downgraded — %d credits left, needs %d",
        remaining,
        THINKING_CREDIT_MULTIPLIER,
      )
      thinking = false
    }
  }
  const creditsCharged = thinking ? THINKING_CREDIT_MULTIPLIER : 1

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

  // ── Generation-run bookkeeping ─────────────────────────────────────
  //
  // The claim comes BEFORE tryConsumeAiCredit on purpose: that ordering is the
  // whole reason a resumed run cannot double-charge. If this day was already
  // generated by this run, or another attempt is mid-flight, we return/refuse
  // without ever touching the credit ledger.
  if (runId) {
    const state = await beginRunDay(generationRunStore, {
      runId,
      dayId,
      userId: session.user.id,
      now: new Date(),
    })
    if (state === "not-found") {
      throw createError({ statusCode: 404, message: "Generation run not found." })
    }
    if (state === "already-done") {
      // Not an error: the resumed loop asked for a day that is already done.
      // Reported as a no-op so the caller advances instead of retrying.
      return {
        success: true,
        skipped: true,
        added: 0,
        removed: 0,
        updated: 0,
        optimized: false,
        enrichmentFailures: 0,
        intent,
        message: "This day was already generated by this run.",
      }
    }
    if (state === "in-flight") {
      throw createError({
        statusCode: 409,
        message: "This day is already being generated. Give it a moment.",
      })
    }
  }

  // Set by every refund path below so the run's credit tally can be reversed
  // in step with the ledger — a refunded day must not stay on the run's bill.
  //
  // `usageMonth` is threaded in from the consume rather than recomputed: a
  // refund must reverse the month the spend was actually attributed to, not
  // whatever month it happens to be when the failure lands (a request that
  // starts at 23:59 on the 31st must not credit the next month's bucket).
  let creditRefunded = false
  // Tracks how much of `creditsCharged` has actually left the ledger so far —
  // see `chargedSoFar`. Starts at `false`: only `tryConsumeAiCredit`'s flat 1
  // credit has been taken until the extra-credit charge below succeeds. This
  // is what makes refundOnce correct on BOTH sides of that charge: refunding
  // the full `creditsCharged` before it has run would mint the difference as
  // free credits (only 1 was ever taken); refunding just 1 after it has run
  // would pocket the other 2 on every later failure.
  let extraChargeApplied = false
  const refundOnce = async (usageMonth: string): Promise<void> => {
    if (creditRefunded) return
    creditRefunded = true
    await refundAiCredit(
      session.user.id,
      usageMonth,
      chargedSoFar(creditsCharged, extraChargeApplied),
    )
  }

  const generate = async () => {
    // Atomically consume one AI credit (throws 429 if limit reached). Kept last
    // among the rejections that can be known without calling the model, so a
    // 403/404 never burns a credit. Note this still runs *after* the run claim
    // above, so a racer that loses the claim never reaches the ledger at all.
    const usageMonth = await tryConsumeAiCredit(session.user.id)

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

    // The forward counterpart of previousStayDay. Only used in thinking mode:
    // it is what lets generation see that the traveler relocates tomorrow and
    // finish today on the right side of the region.
    //
    // resolveStayContext carries "tonight" forward across a multi-night stay
    // (only the FIRST day of a stay sets accommodationName — see
    // buildTripShapeCtx) and only reports `next` when TOMORROW's carried stay
    // genuinely differs from tonight's. Reading day.accommodationName alone —
    // which is null on every night but the first — used to let a stay several
    // days out masquerade as relocating "after tonight" (finding 1, whole-
    // branch review): on an A/A/A/B trip, planning day 2 (still two nights
    // from the actual move) saw nextLocation = Hotel B.
    const { tonight: tonightStay, next: nextLocation } = resolveStayContext(
      allTripDays.map((d) => ({
        dayNumber: d.dayNumber,
        accommodationName: d.accommodationName,
        accommodationAddress: d.accommodationAddress,
        accommodationLat: d.accommodationLat,
        accommodationLng: d.accommodationLng,
      })),
      day.dayNumber,
    )

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

    // The AI prompt and the web-research query want a CITY or area, never a
    // street address. This used to be `"<full street address> (near <dest>)"`,
    // which reached the model as `ALL places must be in 4-1 Nishishinjuku,
    // Shinjuku City, Tokyo 160-0023 (near Japan)` — a nonsensical constraint and
    // a poor search query, and it made the research cache key differ per day.
    //
    // Geographic precision comes from coordinates instead: dayCoords biases the
    // Places lookup during enrichment. Prefer the day's accommodation (where the
    // traveler actually is) over whichever activity happens to sort first.
    const dayLocation = trip.destination
    const geoActivity = day.activities.find((a) => a.lat != null && a.lng != null)
    const dayCoords =
      day.accommodationLat != null && day.accommodationLng != null
        ? { lat: day.accommodationLat, lng: day.accommodationLng }
        : geoActivity
          ? { lat: geoActivity.lat!, lng: geoActivity.lng! }
          : undefined

    // Process the user's request through the AI.
    //
    // Wrapped in a wall-clock budget: `processUserRequest` runs its model calls
    // through `withOneRetry`, so a thinking-mode generation can invoke the model
    // TWICE at ~8x normal latency. Without this the platform would kill the
    // function mid-call — skipping the catch below, so the credit consumed above
    // is never refunded and a run-bound request leaves its `runId` claimed until
    // the stale-claim window expires. The timeout cannot recall the in-flight
    // call, but it returns control here while the function is still alive, which
    // is what lets the refund run at all.
    let result
    try {
      result = await withTimeout(
        processUserRequest({
          prompt,
          intent,
          destination: dayLocation,
          tripDestination: trip.destination,
          // Research cache identity + search query. `destination` is free text (the
          // trip name, or a country name); the country code disambiguates two trips
          // to the same-named city, and the country name sharpens the web search.
          countryCode: trip.countryCode,
          countryName: trip.countryCode
            ? (countryByAlpha2.get(trip.countryCode)?.name ?? null)
            : null,
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
            ? {
                name: startLocation.name,
                address: startLocation.address,
                // Fetched at :168-175 and, until now, discarded right here. Without
                // them the model geolocated last night's hotel from its name alone.
                lat: startLocation.lat,
                lng: startLocation.lng,
              }
            : undefined,
          nextLocation: thinking && nextLocation ? nextLocation : undefined,
          tonightAccommodation: thinking && tonightStay ? { name: tonightStay.name } : undefined,
          tripShape: thinking
            ? allTripDays.map((d) => ({
                dayNumber: d.dayNumber,
                date: d.date,
                accommodationName: d.accommodationName,
              }))
            : undefined,
          preferences: trip.preferences ?? undefined,
          party: await loadPartySize(trip),
          otherDayActivities,
          tripNotes: trip.tripNotes,
          savedIdeas: savedIdeasRows,
          flights,
          thinking,
        }),
        GENERATION_MODEL_BUDGET_MS,
        "day generation",
      )
    } catch (e: unknown) {
      console.error("[ai.post] AI processing failed:", e)
      // Reached before the extra-credit charge below, so refundOnce refunds
      // only the flat 1 credit tryConsumeAiCredit took — see chargedSoFar.
      await refundOnce(usageMonth)
      throw createError({
        statusCode: 502,
        message: "AI service is temporarily unavailable. Please try again.",
      })
    }

    // Charge the remaining THINKING_CREDIT_MULTIPLIER-1 credits only now that
    // the model call has actually succeeded — moved here (was: before
    // processUserRequest) so a thinking-mode generation that fails or times
    // out via withOneRetry's double model call (~8x normal latency, no
    // wall-clock guard) is never billed 3 credits for work that never
    // completed. tryConsumeAiCredit's flat 1 credit still runs first and
    // still owns the 429 gate, so no work is ever given away free.
    await chargeExtraAiCredits(session.user.id, creditsCharged - 1, usageMonth)
    extraChargeApplied = true

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
    /** Names Google could not resolve — surfaced so the traveler knows what was dropped. */
    let unlocatedNames: string[] = []

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
        let enriched
        try {
          enriched = await enrichItinerary(
            { days: [{ dayNumber: day.dayNumber, theme: "", activities: deduped }] },
            dayLocation,
            dayCoords,
          )

          enrichmentFailures = enriched.enrichmentFailures
          const enrichedActivities = enriched.days[0]?.activities ?? []
          // Never persist an activity Google could not locate: enrich.ts states
          // the invariant outright — a null-coordinate row is invisible on the
          // map and skipped by the segments engine. enrichActivity returns a
          // FULL object with lat/lng null on failure rather than dropping it, so
          // without this split those rows were inserted, and `addedCount` counted
          // them — which also defeated the refund guard below in exactly the case
          // it exists for (every suggestion failed to geocode).
          const { located, unlocated } = partitionGeocoded(enrichedActivities)
          console.log("[ai.post] After enrich:", {
            count: enrichedActivities.length,
            located: located.length,
            failures: enrichmentFailures,
          })

          if (located.length > 0) {
            const currentActivities = await db.query.activities.findMany({
              where: eq(activities.itineraryDayId, dayId),
              orderBy: [asc(activities.sortOrder)],
            })
            const maxSort =
              currentActivities.length > 0
                ? Math.max(...currentActivities.map((a) => a.sortOrder))
                : -1

            const guardedCosts = await Promise.all(
              located.map((a) =>
                guardCostEstimate({
                  costEstimate: a.costEstimate,
                  type: a.type,
                  placeId: a.placeId,
                  currencyCode: trip.currencyCode || "USD",
                }),
              ),
            )

            await db.insert(activities).values(
              located.map((activity, index) => ({
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
            addedCount = located.length
          }
          unlocatedNames = unlocated.map((a) => a.name)
        } catch (e: unknown) {
          console.error("[ai.post] Enrichment failed:", e)
          // Only bail when the request achieved nothing at all. `modify` removes
          // activities before this point and `fill_gaps` can fill blank times —
          // that work is already committed, so throwing would strand the day in a
          // half-applied state AND refund a request that did change something.
          // In that case fall through and report the partial result instead.
          if (addedCount === 0 && removedCount === 0 && updatedCount === 0) {
            await refundOnce(usageMonth)
            throw createError({
              statusCode: 502,
              message: "Couldn't look those places up on Google Maps. Please try again.",
            })
          }
        }

        // Distinct from the exception above: enrichment SUCCEEDED but Google
        // located nothing, so nothing was inserted and no exception was thrown —
        // the catch never ran. Same rule applies: only bail when the request
        // achieved nothing at all, otherwise report the partial result.
        if (
          addedCount === 0 &&
          removedCount === 0 &&
          updatedCount === 0 &&
          unlocatedNames.length > 0
        ) {
          await refundOnce(usageMonth)
          throw createError({
            statusCode: 422,
            message:
              unlocatedNames.length === 1
                ? `Couldn't find "${unlocatedNames[0]}" on Google Maps. Try a more specific request.`
                : "Couldn't find any of those places on Google Maps. Try a more specific request.",
          })
        }
      }
    }

    // Handle accommodation booking. One transaction with `reconcileTripStays`,
    // exactly like the accommodation routes and the set-accommodation apply:
    // `accommodation_*` is a read-cache of `stays`, so writing it without
    // reconciling leaves the itinerary showing one hotel while `stays` and the
    // mirrored booking still hold the previous one — and the next accommodation
    // edit then detaches and deletes the stay whose booking holds the user's
    // confirmation number and amount.
    if (result.accommodation) {
      const accommodation = result.accommodation
      await db.transaction(async (tx) => {
        // Before the day write, never after — see `lockTripForStayWrite`.
        await lockTripForStayWrite(tx, id)

        await tx
          .update(itineraryDays)
          .set({
            accommodationName: accommodation.name,
            accommodationAddress: accommodation.address,
            accommodationLat: accommodation.lat,
            accommodationLng: accommodation.lng,
            accommodationPlaceId: accommodation.placeId,
          })
          .where(eq(itineraryDays.id, dayId))

        await reconcileTripStays(tx, id, session.user.id)
      })
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
          const departureMinutes = Math.max(
            7 * 60,
            earliestActivityMinutes - startTravelTimeMinutes,
          )
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
      skipped: false,
      added: addedCount,
      removed: removedCount,
      updated: updatedCount,
      optimized,
      enrichmentFailures,
      intent: result.intent,
      // Name what was dropped. Silently returning a smaller number than the AI
      // suggested reads as the model under-delivering rather than Google failing.
      message:
        unlocatedNames.length > 0
          ? `${result.message} · couldn't locate ${unlocatedNames.length} (${unlocatedNames.join(", ")})`
          : result.message,
    }
  }

  if (!runId) return generate()

  try {
    const result = await generate()
    await endRunDay(generationRunStore, { runId, dayId, ok: true })
    return result
  } catch (e) {
    // Best-effort: if this write fails the day is left `in_progress` and the
    // stale-claim window makes it retryable anyway.
    await endRunDay(generationRunStore, {
      runId,
      dayId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      refunded: creditRefunded,
    })
    throw e
  }
})
