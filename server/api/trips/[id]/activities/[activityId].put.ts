import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { activities } from "../../../../db/schema";
import { activityIdParamsSchema, updateActivitySchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, activityId } = await getValidatedRouterParams(
    event,
    activityIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, updateActivitySchema.parse);

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

  const [updated] = await db
    .update(activities)
    .set(body)
    .where(eq(activities.id, activityId))
    .returning();

  return updated;
});
