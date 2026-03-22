import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../db";
import { trips, itineraryDays, activities } from "../../../../../db/schema";
import { dayIdParamsSchema } from "../../../../../utils/schemas";
import { optimizeDayRoute } from "../../../../../lib/ai";
import { computeAndSaveSegments } from "../../../../../lib/segments";
import { getDistanceMatrix } from "../../../../../lib/google-maps";
import { sanitizePromptInput } from "../../../../../utils/sanitize";

const optimizeBodySchema = z.object({
  context: z.string().max(2000).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse);
  const body = await readValidatedBody(event, optimizeBodySchema.parse);

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

  if (day.activities.length < 2) {
    throw createError({ statusCode: 400, message: "Need at least 2 activities to optimize" });
  }

  // Ask AI to determine optimal ORDER only
  const optimized = await optimizeDayRoute({
    destination: trip.destination,
    activities: day.activities.map((a) => ({
      name: a.name,
      address: a.address,
      lat: a.lat,
      lng: a.lng,
      suggestedTime: a.suggestedTime,
    })),
    userContext: sanitizedContext,
  });

  // Map AI-returned order to actual activity objects
  const orderedActivities = optimized.orderedActivities
    .map((opt) => {
      return day.activities.find(
        (a) => a.name.toLowerCase().trim() === opt.name.toLowerCase().trim()
      );
    })
    .filter((a): a is typeof day.activities[number] => !!a);

  // Include any activities the AI missed (append at end)
  const orderedIds = new Set(orderedActivities.map((a) => a.id));
  for (const a of day.activities) {
    if (!orderedIds.has(a.id)) {
      orderedActivities.push(a);
    }
  }

  // Fetch actual travel times between consecutive activities from Distance Matrix API
  const geoActivities = orderedActivities.filter((a) => a.lat != null && a.lng != null);
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
    } catch (e) {
      console.error("Failed to fetch travel times for schedule:", e);
    }
  }

  // Determine start time — use earliest existing time, or default to 09:00
  let startHour = 9;
  let startMinute = 0;
  const existingTimes = day.activities
    .map((a) => a.suggestedTime)
    .filter((t): t is string => !!t)
    .map((t) => {
      const match = t.match(/^(\d{1,2}):(\d{2})/);
      return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : null;
    })
    .filter((m): m is number => m !== null);

  if (existingTimes.length > 0) {
    const earliest = Math.min(...existingTimes);
    startHour = Math.floor(earliest / 60);
    startMinute = earliest % 60;
  }

  // Compute proper non-overlapping schedule (respects opening hours)
  const dayDate = day.date;
  const schedule = computeSchedule({
    activities: orderedActivities.map((a) => ({
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

  // Apply computed schedule to database
  await Promise.all(
    schedule.map((s) =>
      db
        .update(activities)
        .set({
          sortOrder: s.sortOrder,
          suggestedTime: s.suggestedTime,
        })
        .where(eq(activities.id, s.id))
    )
  );

  // Recompute travel segments with new order
  await computeAndSaveSegments(dayId);

  return { success: true };
});
