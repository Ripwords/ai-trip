import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, itineraryDays, activities } from "../../../../db/schema";
import { uuidParamsSchema, reorderActivitiesSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, reorderActivitiesSchema.parse);

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Verify all activities belong to this trip
  const activityIds = body.activities.map((a) => a.id);
  const existingActivities = await db.query.activities.findMany({
    where: inArray(activities.id, activityIds),
    with: {
      day: true,
    },
  });

  const allBelongToTrip = existingActivities.every(
    (a) => a.day.tripId === id
  );

  if (existingActivities.length !== activityIds.length || !allBelongToTrip) {
    throw createError({
      statusCode: 400,
      message: "One or more activities do not belong to this trip",
    });
  }

  // Update sort orders
  await Promise.all(
    body.activities.map((item) =>
      db
        .update(activities)
        .set({ sortOrder: item.sortOrder })
        .where(eq(activities.id, item.id))
    )
  );

  return { success: true };
});
