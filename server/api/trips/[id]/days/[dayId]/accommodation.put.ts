import { and, eq } from "drizzle-orm";
import { db } from "../../../../../db";
import { trips, itineraryDays } from "../../../../../db/schema";
import { dayIdParamsSchema, updateAccommodationSchema } from "../../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse);
  const body = await readValidatedBody(event, updateAccommodationSchema.parse);

  // Verify trip ownership
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

  const [updated] = await db
    .update(itineraryDays)
    .set(body)
    .where(eq(itineraryDays.id, dayId))
    .returning();

  return updated;
});
