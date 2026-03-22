import { and, eq } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, checklists } from "../../../../db/schema";
import { checklistIdParamsSchema, updateChecklistSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, checklistId } = await getValidatedRouterParams(
    event,
    checklistIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, updateChecklistSchema.parse);

  // Verify trip belongs to user
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Verify checklist belongs to trip
  const checklist = await db.query.checklists.findFirst({
    where: and(eq(checklists.id, checklistId), eq(checklists.tripId, id)),
  });

  if (!checklist) {
    throw createError({ statusCode: 404, message: "Checklist not found" });
  }

  const [updated] = await db
    .update(checklists)
    .set(body)
    .where(eq(checklists.id, checklistId))
    .returning();

  return updated;
});
