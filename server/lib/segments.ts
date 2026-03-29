import { eq, asc } from "drizzle-orm";
import { db } from "../db";
import { activities, travelSegments } from "../db/schema";
import { getDistanceMatrix } from "./google-maps";

export async function computeAndSaveSegments(dayId: string): Promise<void> {
  // 1. Get activities for this day ordered by sortOrder
  const dayActivities = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    orderBy: [asc(activities.sortOrder)],
  });

  // 2. Filter to those with coordinates
  const geoActivities = dayActivities.filter(
    (a) => a.lat != null && a.lng != null
  );

  // 3. Delete existing segments for this day
  await db.delete(travelSegments).where(eq(travelSegments.itineraryDayId, dayId));

  // 4. Need at least 2 activities with coords
  if (geoActivities.length < 2) return;

  try {
    // 5. Build origins/destinations for consecutive pairs
    const origins = geoActivities.slice(0, -1).map((a) => ({
      lat: a.lat!,
      lng: a.lng!,
    }));
    const destinations = geoActivities.slice(1).map((a) => ({
      lat: a.lat!,
      lng: a.lng!,
    }));

    // 6. Call Distance Matrix API
    const matrix = await getDistanceMatrix(origins, destinations);

    // 7. Insert segments for each consecutive pair
    const segmentValues = geoActivities.slice(0, -1).map((activity, i) => {
      const element = matrix[i]?.[i]; // diagonal: origin i to destination i
      return {
        itineraryDayId: dayId,
        fromActivityId: activity.id,
        toActivityId: geoActivities[i + 1]!.id,
        durationSeconds: element?.duration?.value ?? null,
        distanceMeters: element?.distance?.value ?? null,
        durationText: element?.duration?.text ?? null,
        distanceText: element?.distance?.text ?? null,
        mode: "driving" as const,
      };
    });

    if (segmentValues.length > 0) {
      await db.insert(travelSegments).values(segmentValues);
    }
  } catch (error) {
    // Segments are non-blocking — log but don't throw
    console.error("Failed to compute travel segments:", error);
  }
}
