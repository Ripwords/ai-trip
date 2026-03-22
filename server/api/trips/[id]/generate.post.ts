import { and, eq, asc } from "drizzle-orm";
import { db } from "../../../db";
import { trips, itineraryDays, activities } from "../../../db/schema";
import { uuidParamsSchema } from "../../../utils/schemas";
import { generateItinerary } from "../../../lib/ai";
import { enrichItinerary } from "../../../lib/enrich";
import { computeAndSaveSegments } from "../../../lib/segments";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
        },
      },
    },
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Collect existing activities as context for AI
  const existingActivities = trip.days.flatMap((day) =>
    day.activities.map((a) => ({
      dayNumber: day.dayNumber,
      name: a.name,
      type: a.type,
      suggestedTime: a.suggestedTime,
      estimatedDurationMinutes: a.estimatedDurationMinutes,
    }))
  );

  // Generate AI itinerary (aware of existing plans)
  const aiOutput = await generateItinerary({
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    preferences: trip.preferences ?? undefined,
    existingActivities: existingActivities.length > 0 ? existingActivities : undefined,
  });

  // Enrich with Google Maps data
  const enriched = await enrichItinerary(aiOutput, trip.destination);

  // Add AI-generated activities to existing days (don't delete existing activities)
  for (const aiDay of enriched.days) {
    // Find the matching existing day
    const existingDay = trip.days.find((d) => d.dayNumber === aiDay.dayNumber);
    if (!existingDay) continue; // Skip if no matching day exists

    // Get the current max sortOrder for this day
    const maxSort = existingDay.activities.length > 0
      ? Math.max(...existingDay.activities.map((a) => a.sortOrder))
      : -1;

    // Insert only AI-generated activities (appended after existing ones)
    if (aiDay.activities.length > 0) {
      await db.insert(activities).values(
        aiDay.activities.map((activity, index) => ({
          itineraryDayId: existingDay.id,
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
    }

    await computeAndSaveSegments(existingDay.id);
  }

  // Update trip status
  await db
    .update(trips)
    .set({ status: "planned" })
    .where(eq(trips.id, id));

  // Return full trip with populated itinerary
  const result = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    with: {
      days: {
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  });

  return result;
});
