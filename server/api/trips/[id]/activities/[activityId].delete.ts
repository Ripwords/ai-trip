import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { activities } from "../../../../db/schema";
import { activityIdParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, activityId } = await getValidatedRouterParams(
    event,
    activityIdParamsSchema.parse
  );

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

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

  const activityName = activity.name;
  await db.delete(activities).where(eq(activities.id, activityId));

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "activity_removed",
    description: `Removed "${activityName}"`,
  });

  return { success: true };
});
