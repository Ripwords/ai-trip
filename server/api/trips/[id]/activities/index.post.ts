import { and, eq, desc } from "drizzle-orm";
import { db } from "../../../../db";
import { itineraryDays, activities } from "../../../../db/schema";
import { uuidParamsSchema, addActivitySchema } from "../../../../utils/schemas";
import { computeAndSaveSegments } from "../../../../lib/segments";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, addActivitySchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  // Verify itineraryDayId belongs to trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(
      eq(itineraryDays.id, body.itineraryDayId),
      eq(itineraryDays.tripId, id)
    ),
  });

  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" });
  }

  // Get max sortOrder for that day
  const lastActivity = await db.query.activities.findFirst({
    where: eq(activities.itineraryDayId, body.itineraryDayId),
    orderBy: [desc(activities.sortOrder)],
  });
  const sortOrder = (lastActivity?.sortOrder ?? -1) + 1;

  const { itineraryDayId, ...rest } = body;

  const [activity] = await db
    .insert(activities)
    .values({
      ...rest,
      itineraryDayId,
      sortOrder,
    })
    .returning();

  // Recompute segments
  await computeAndSaveSegments(itineraryDayId);

  return activity;
});
