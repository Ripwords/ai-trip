import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, tripIdeas } from "../../../../db/schema";
import { ideaIdParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, ideaId } = await getValidatedRouterParams(
    event,
    ideaIdParamsSchema.parse
  );

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Verify idea belongs to trip
  const idea = await db.query.tripIdeas.findFirst({
    where: and(eq(tripIdeas.id, ideaId), eq(tripIdeas.tripId, id)),
  });

  if (!idea) {
    throw createError({ statusCode: 404, message: "Idea not found" });
  }

  await db.delete(tripIdeas).where(eq(tripIdeas.id, ideaId));

  return { success: true };
});
