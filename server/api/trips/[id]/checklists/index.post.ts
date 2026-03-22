import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, checklists } from "../../../../db/schema";
import { uuidParamsSchema, createChecklistSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, createChecklistSchema.parse);

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  const [checklist] = await db
    .insert(checklists)
    .values({ ...body, tripId: id })
    .returning();

  return checklist;
});
