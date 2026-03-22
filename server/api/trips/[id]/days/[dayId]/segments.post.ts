import { and, eq } from "drizzle-orm";
import { db } from "../../../../../db";
import { trips, itineraryDays, travelSegments } from "../../../../../db/schema";
import { dayIdParamsSchema } from "../../../../../utils/schemas";
import { computeAndSaveSegments } from "../../../../../lib/segments";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, dayId } = await getValidatedRouterParams(
    event,
    dayIdParamsSchema.parse
  );

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Verify day belongs to trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
  });

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" });
  }

  await computeAndSaveSegments(dayId);

  return db.query.travelSegments.findMany({
    where: eq(travelSegments.itineraryDayId, dayId),
  });
});
