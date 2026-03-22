import { and, eq } from "drizzle-orm";
import { db } from "../../../../../../db";
import { trips, checklists, checklistItems } from "../../../../../../db/schema";
import { checklistItemIdParamsSchema, updateChecklistItemSchema } from "../../../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, checklistId, itemId } = await getValidatedRouterParams(
    event,
    checklistItemIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, updateChecklistItemSchema.parse);

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

  // Verify item belongs to checklist
  const item = await db.query.checklistItems.findFirst({
    where: and(
      eq(checklistItems.id, itemId),
      eq(checklistItems.checklistId, checklistId)
    ),
  });

  if (!item) {
    throw createError({ statusCode: 404, message: "Checklist item not found" });
  }

  const [updated] = await db
    .update(checklistItems)
    .set(body)
    .where(eq(checklistItems.id, itemId))
    .returning();

  return updated;
});
