import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, tripIdeas } from "../../../../db/schema";
import { uuidParamsSchema, createIdeaSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, createIdeaSchema.parse);

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  const [idea] = await db
    .insert(tripIdeas)
    .values({ ...body, tripId: id })
    .returning();

  return idea;
});
