import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { trips, itineraryDays, activities } from "../../../../../db/schema";
import { dayIdParamsSchema } from "../../../../../utils/schemas";
import { processUserRequest } from "../../../../../lib/ai";
import { enrichItinerary } from "../../../../../lib/enrich";
import { computeAndSaveSegments } from "../../../../../lib/segments";
import { getDistanceMatrix } from "../../../../../lib/google-maps";
import { sanitizePromptInput } from "../../../../../utils/sanitize";

const aiBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse);
  const body = await readValidatedBody(event, aiBodySchema.parse);

  // Sanitize prompt
  const prompt = sanitizePromptInput(body.prompt);
  if (!prompt) {
    throw createError({
      statusCode: 400,
      message: "Your prompt contains disallowed content. Please describe your travel preferences only.",
    });
  }

  // Verify trip ownership
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Get the day with activities
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
    with: {
      activities: {
        orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
      },
    },
  });

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" });
  }

  // Derive day location from activities/accommodation
  let dayLocation = trip.destination;
  const addresses = day.activities.map((a) => a.address).filter((a): a is string => !!a);
  if (addresses.length > 0) {
    dayLocation = `${addresses[0]} (near ${trip.destination})`;
  }
  if (day.accommodationAddress) {
    dayLocation = `${day.accommodationAddress} (near ${trip.destination})`;
  }

  // Process the user's request through the AI
  const result = await processUserRequest({
    prompt,
    destination: dayLocation,
    tripDestination: trip.destination,
    date: day.date,
    dayNumber: day.dayNumber,
    existingActivities: day.activities.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      suggestedTime: a.suggestedTime,
      estimatedDurationMinutes: a.estimatedDurationMinutes,
      address: a.address,
    })),
    accommodation: day.accommodationName
      ? { name: day.accommodationName, address: day.accommodationAddress }
      : undefined,
    preferences: trip.preferences ?? undefined,
  });

  console.log("[ai.post] AI result:", {
    intent: result.intent,
    message: result.message,
    newActivities: result.newActivities.length,
    newActivityNames: result.newActivities.map((a) => a.name),
    removals: result.removals.length,
    updates: result.updates.length,
    shouldOptimize: result.shouldOptimize,
  });

  let addedCount = 0;
  let removedCount = 0;
  let updatedCount = 0;
  let optimized = false;

  // Handle removals
  if (result.removals.length > 0) {
    for (const removal of result.removals) {
      const match = day.activities.find(
        (a) => a.name.toLowerCase().trim() === removal.name.toLowerCase().trim()
      );
      if (match) {
        await db.delete(activities).where(eq(activities.id, match.id));
        removedCount++;
      }
    }
  }

  // Handle time/duration updates
  if (result.updates.length > 0) {
    const isReschedule = result.intent === "reschedule";
    for (const update of result.updates) {
      const match = day.activities.find(
        (a) => a.name.toLowerCase().trim() === update.name.toLowerCase().trim()
      );
      if (!match) continue;

      // For reschedule: always overwrite times. For other intents: only fill blanks.
      if (isReschedule) {
        await db.update(activities).set({
          suggestedTime: update.suggestedTime,
          estimatedDurationMinutes: update.estimatedDurationMinutes,
        }).where(eq(activities.id, match.id));
        updatedCount++;
      } else if (!match.suggestedTime || !match.estimatedDurationMinutes) {
        const setFields: Record<string, unknown> = {};
        if (!match.suggestedTime) setFields.suggestedTime = update.suggestedTime;
        if (!match.estimatedDurationMinutes) setFields.estimatedDurationMinutes = update.estimatedDurationMinutes;
        if (Object.keys(setFields).length > 0) {
          await db.update(activities).set(setFields).where(eq(activities.id, match.id));
          updatedCount++;
        }
      }
    }
  }

  // Handle new activities
  if (result.newActivities.length > 0) {
    // Dedup against existing names
    const existingNames = new Set(
      day.activities
        .filter((a) => !result.removals.some((r) => r.name.toLowerCase().trim() === a.name.toLowerCase().trim()))
        .map((a) => a.name.toLowerCase().trim())
    );

    const deduped = result.newActivities.filter((a) => {
      const n = a.name.toLowerCase().trim();
      return !existingNames.has(n) && ![...existingNames].some((e) => e.includes(n) || n.includes(e));
    });

    console.log("[ai.post] After dedup:", { before: result.newActivities.length, after: deduped.length, existingNames: [...existingNames] });

    if (deduped.length > 0) {
      // Enrich with Google Maps
      const enriched = await enrichItinerary(
        { days: [{ dayNumber: day.dayNumber, theme: "", activities: deduped }] },
        dayLocation
      );

      const enrichedActivities = enriched.days[0]?.activities ?? [];
      console.log("[ai.post] After enrich:", { count: enrichedActivities.length, names: enrichedActivities.map((a) => a.name) });

      if (enrichedActivities.length > 0) {
        const currentActivities = await db.query.activities.findMany({
          where: eq(activities.itineraryDayId, dayId),
          orderBy: [asc(activities.sortOrder)],
        });
        const maxSort = currentActivities.length > 0
          ? Math.max(...currentActivities.map((a) => a.sortOrder))
          : -1;

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
          }))
        );
        addedCount = enrichedActivities.length;
      }
    }
  }

  // Handle route optimization
  if (result.shouldOptimize) {
    const allDayActivities = await db.query.activities.findMany({
      where: eq(activities.itineraryDayId, dayId),
      orderBy: [asc(activities.sortOrder)],
    });

    if (allDayActivities.length >= 2) {
      // Get travel times
      const geoActivities = allDayActivities.filter((a) => a.lat != null && a.lng != null);
      const travelTimes: { fromId: string; toId: string; durationMinutes: number }[] = [];

      if (geoActivities.length >= 2) {
        try {
          const origins = geoActivities.slice(0, -1).map((a) => ({ lat: a.lat!, lng: a.lng! }));
          const destinations = geoActivities.slice(1).map((a) => ({ lat: a.lat!, lng: a.lng! }));
          const matrix = await getDistanceMatrix(origins, destinations);
          for (let i = 0; i < origins.length; i++) {
            const element = matrix[i]?.[i];
            if (element?.duration?.value) {
              travelTimes.push({
                fromId: geoActivities[i].id,
                toId: geoActivities[i + 1].id,
                durationMinutes: Math.ceil(element.duration.value / 60),
              });
            }
          }
        } catch { /* proceed without travel times */ }
      }

      // Compute schedule
      const dayDate = day.date;
      let startHour = 9;
      let startMinute = 0;
      const times = allDayActivities
        .map((a) => a.suggestedTime)
        .filter((t): t is string => !!t)
        .map((t) => { const m = t.match(/^(\d{1,2}):(\d{2})/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null; })
        .filter((m): m is number => m !== null);
      if (times.length > 0) {
        const earliest = Math.min(...times);
        startHour = Math.floor(earliest / 60);
        startMinute = earliest % 60;
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
        bufferMinutes: 15,
      });

      await Promise.all(
        schedule.map((s) =>
          db.update(activities).set({ sortOrder: s.sortOrder, suggestedTime: s.suggestedTime }).where(eq(activities.id, s.id))
        )
      );
      optimized = true;
    }
  }

  // Recompute segments
  await computeAndSaveSegments(dayId);

  return {
    success: true,
    added: addedCount,
    removed: removedCount,
    updated: updatedCount,
    optimized,
    intent: result.intent,
    message: result.message,
  };
});
