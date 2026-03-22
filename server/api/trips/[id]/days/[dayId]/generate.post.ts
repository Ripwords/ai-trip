import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { trips, itineraryDays, activities } from "../../../../../db/schema";
import { dayIdParamsSchema } from "../../../../../utils/schemas";
import { generateForDay } from "../../../../../lib/ai";
import { enrichItinerary } from "../../../../../lib/enrich";
import { computeAndSaveSegments } from "../../../../../lib/segments";
import { sanitizePromptInput } from "../../../../../utils/sanitize";
import { getDistanceMatrix } from "../../../../../lib/google-maps";

const generateBodySchema = z.object({
  context: z.string().max(2000).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse);
  const body = await readValidatedBody(event, generateBodySchema.parse);

  // Sanitize user prompt — reject injection attempts
  let sanitizedContext: string | undefined;
  if (body.context) {
    const cleaned = sanitizePromptInput(body.context);
    if (cleaned === null) {
      throw createError({
        statusCode: 400,
        message: "Your prompt contains disallowed content. Please describe your travel preferences only.",
      });
    }
    sanitizedContext = cleaned;
  }

  // Verify trip ownership
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Get the day with its existing activities
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

  // Collect existing activities as context (include id for removal tool)
  const existingActivities = day.activities.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    suggestedTime: a.suggestedTime,
    estimatedDurationMinutes: a.estimatedDurationMinutes,
    address: a.address,
  }));

  // Build set of existing names for deduplication
  const existingNames = new Set(
    day.activities.map((a) => a.name.toLowerCase().trim())
  );

  // Derive the day's location from existing activity addresses
  // This ensures AI suggests places nearby, not in a different city
  let dayLocation = trip.destination;
  if (day.activities.length > 0) {
    const addresses = day.activities
      .map((a) => a.address)
      .filter((a): a is string => !!a);
    if (addresses.length > 0) {
      dayLocation = `${addresses[0]} (near ${trip.destination})`;
    }
  }
  // Also check accommodation
  if (day.accommodationAddress) {
    dayLocation = `${day.accommodationAddress} (near ${trip.destination})`;
  }

  // Generate AI suggestions for this day only
  const aiOutput = await generateForDay({
    destination: dayLocation,
    tripDestination: trip.destination,
    date: day.date,
    dayNumber: day.dayNumber,
    preferences: trip.preferences ?? undefined,
    existingActivities: existingActivities.length > 0 ? existingActivities : undefined,
    accommodation: day.accommodationName
      ? { name: day.accommodationName, address: day.accommodationAddress }
      : undefined,
    userContext: sanitizedContext,
  });

  // Removals are handled by the agent's removeActivity tool during generation
  const removedCount = aiOutput.removedActivityIds?.length ?? 0;

  // Remove deleted activity names from dedup set
  for (const removedId of aiOutput.removedActivityIds ?? []) {
    const removedAct = day.activities.find((a) => a.id === removedId);
    if (removedAct) {
      existingNames.delete(removedAct.name.toLowerCase().trim());
    }
  }

  // Apply time/duration updates to existing activities that were missing them
  if (aiOutput.existingActivityUpdates?.length) {
    const updatePromises = aiOutput.existingActivityUpdates.map((update) => {
      const match = day.activities.find(
        (a) => a.name.toLowerCase().trim() === update.name.toLowerCase().trim()
      );
      if (match && (!match.suggestedTime || !match.estimatedDurationMinutes)) {
        const setFields: Record<string, unknown> = {};
        if (!match.suggestedTime) setFields.suggestedTime = update.suggestedTime;
        if (!match.estimatedDurationMinutes) setFields.estimatedDurationMinutes = update.estimatedDurationMinutes;
        if (Object.keys(setFields).length > 0) {
          return db.update(activities).set(setFields).where(eq(activities.id, match.id));
        }
      }
      return null;
    });
    await Promise.all(updatePromises.filter(Boolean));
  }

  // Enrich with Google Maps data (use dayLocation so Places API searches near the right city)
  const enriched = await enrichItinerary(
    { days: [{ dayNumber: day.dayNumber, theme: aiOutput.theme, activities: aiOutput.activitiesToAdd }] },
    dayLocation
  );

  const enrichedDay = enriched.days[0];
  let addedCount = 0;

  if (!enrichedDay || enrichedDay.activities.length === 0) {
    // No new activities from AI, but we may have updated existing ones
    await computeAndSaveSegments(dayId);
    const updatedCount = aiOutput.existingActivityUpdates?.length ?? 0;
    return { success: true, added: 0, updated: updatedCount };
  }

  // Filter out duplicates — check against existing activity names
  const newActivities = enrichedDay.activities.filter((a) => {
    const aiName = a.name.toLowerCase().trim();
    // Check exact match
    if (existingNames.has(aiName)) return false;
    // Check if existing name contains AI name or vice versa (fuzzy match)
    for (const existing of existingNames) {
      if (existing.includes(aiName) || aiName.includes(existing)) return false;
    }
    return true;
  });

  // Get max sortOrder for this day
  const maxSort = day.activities.length > 0
    ? Math.max(...day.activities.map((a) => a.sortOrder))
    : -1;

  // Insert only non-duplicate AI-generated activities
  if (newActivities.length > 0) {
    await db.insert(activities).values(
      newActivities.map((activity, index) => ({
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
    addedCount = newActivities.length;
  }

  // Recompute non-overlapping schedule for the entire day
  // This ensures AI-added activities don't overlap with existing ones
  const allDayActivities = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    orderBy: [asc(activities.sortOrder)],
  });

  if (allDayActivities.length >= 2) {
    // Get travel times between consecutive activities
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
      } catch {
        // Distance matrix failed, proceed without travel times
      }
    }

    // Find earliest existing time to use as start
    let startHour = 9;
    let startMinute = 0;
    const existingTimes = allDayActivities
      .map((a) => a.suggestedTime)
      .filter((t): t is string => !!t)
      .map((t) => {
        const m = t.match(/^(\d{1,2}):(\d{2})/);
        return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
      })
      .filter((m): m is number => m !== null);

    if (existingTimes.length > 0) {
      const earliest = Math.min(...existingTimes);
      startHour = Math.floor(earliest / 60);
      startMinute = earliest % 60;
    }

    // Compute non-overlapping schedule (respects opening hours)
    const dayDate = day.date;
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

    // Apply computed times to all activities
    await Promise.all(
      schedule.map((s) =>
        db.update(activities).set({
          sortOrder: s.sortOrder,
          suggestedTime: s.suggestedTime,
        }).where(eq(activities.id, s.id))
      )
    );
  }

  // Recompute travel segments
  await computeAndSaveSegments(dayId);

  // Update trip status
  await db.update(trips).set({ status: "planned" }).where(eq(trips.id, id));

  const updatedCount = aiOutput.existingActivityUpdates?.length ?? 0;
  return { success: true, added: addedCount, updated: updatedCount, removed: removedCount };
});
