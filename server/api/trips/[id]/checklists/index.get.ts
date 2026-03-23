import { eq, asc } from "drizzle-orm";
import { db } from "../../../../db";
import { checklists, checklistItems } from "../../../../db/schema";
import { uuidParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  await requireTripAccess(id, session.user.id);

  return db.query.checklists.findMany({
    where: eq(checklists.tripId, id),
    with: {
      items: {
        orderBy: [asc(checklistItems.sortOrder)],
      },
    },
  });
});
