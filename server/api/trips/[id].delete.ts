import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { trips } from "../../db/schema";
import { uuidParamsSchema } from "../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  const existing = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!existing) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  // Cascade delete is handled by DB foreign key constraints
  await db
    .delete(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)));

  return { success: true };
});
