import { and, eq, asc } from "drizzle-orm";
import { db } from "../../../../../db";
import { checklists, checklistItems, packingTemplates } from "../../../../../db/schema";
import { checklistIdParamsSchema, saveAsTemplateSchema } from "../../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, checklistId } = await getValidatedRouterParams(
    event,
    checklistIdParamsSchema.parse
  );
  const body = await readValidatedBody(event, saveAsTemplateSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  // Verify checklist belongs to trip
  const checklist = await db.query.checklists.findFirst({
    where: and(eq(checklists.id, checklistId), eq(checklists.tripId, id)),
  });

  if (!checklist) {
    throw createError({ statusCode: 404, message: "Checklist not found" });
  }

  // Get all items
  const items = await db.query.checklistItems.findMany({
    where: eq(checklistItems.checklistId, checklistId),
    orderBy: [asc(checklistItems.sortOrder)],
  });

  const [template] = await db
    .insert(packingTemplates)
    .values({
      name: body.name,
      description: body.description ?? undefined,
      userId: session.user.id,
      isGlobal: false,
      items: items.map((item) => ({
        text: item.text,
        category: item.category ?? "General",
      })),
    })
    .returning();

  return template;
});
