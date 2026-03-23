import { eq, desc } from "drizzle-orm";
import { db } from "../../../../db";
import { expenses } from "../../../../db/schema";
import { uuidParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  await requireTripAccess(id, session.user.id);

  return db.query.expenses.findMany({
    where: eq(expenses.tripId, id),
    orderBy: [desc(expenses.createdAt)],
  });
});
