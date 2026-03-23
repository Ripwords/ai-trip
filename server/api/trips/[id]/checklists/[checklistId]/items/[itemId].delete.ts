import { and, eq } from "drizzle-orm";
import { db } from "../../../../../../db";
import { checklists, checklistItems } from "../../../../../../db/schema";
import { checklistItemIdParamsSchema } from "../../../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, checklistId, itemId } = await getValidatedRouterParams(
    event,
    checklistItemIdParamsSchema.parse
  );

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

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

  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));

  return { success: true };
});
