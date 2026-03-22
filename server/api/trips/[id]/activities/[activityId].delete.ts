import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, activities } from "../../../../db/schema";
import { activityIdParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, activityId } = await getValidatedRouterParams(
    event,
    activityIdParamsSchema.parse
  );

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Verify activity belongs to this trip
  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: {
      day: true,
    },
  });

  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" });
  }

  await db.delete(activities).where(eq(activities.id, activityId));

  return { success: true };
});
