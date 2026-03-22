import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { trips } from "../../db/schema";
import { uuidParamsSchema, updateTripSchema } from "../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, updateTripSchema.parse);

  const existing = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
  });

  if (!existing) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  const [updated] = await db
    .update(trips)
    .set(body)
    .where(and(eq(trips.id, id), eq(trips.userId, session.user.id)))
    .returning();

  return updated;
});
