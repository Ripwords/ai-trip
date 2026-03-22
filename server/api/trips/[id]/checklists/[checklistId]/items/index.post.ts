import { and, eq, desc } from "drizzle-orm";
import { db } from "../../../../../../db";
import { trips, checklists, checklistItems } from "../../../../../../db/schema";
import { checklistIdParamsSchema, createChecklistItemSchema } from "../../../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, checklistId } = await getValidatedRouterParams(
    event,
    checklistIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, createChecklistItemSchema.parse);

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

  // If no sortOrder, get max from existing items
  let sortOrder = body.sortOrder;
  if (sortOrder == null) {
    const lastItem = await db.query.checklistItems.findFirst({
      where: eq(checklistItems.checklistId, checklistId),
      orderBy: [desc(checklistItems.sortOrder)],
    });
    sortOrder = (lastItem?.sortOrder ?? -1) + 1;
  }

  const [item] = await db
    .insert(checklistItems)
    .values({
      text: body.text,
      checklistId,
      sortOrder,
    })
    .returning();

  return item;
});
