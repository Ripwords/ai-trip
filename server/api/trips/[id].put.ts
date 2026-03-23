import { eq } from "drizzle-orm";
import { db } from "../../db";
import { trips } from "../../db/schema";
import { uuidParamsSchema, updateTripSchema } from "../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, updateTripSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  const [updated] = await db
    .update(trips)
    .set(body)
    .where(eq(trips.id, id))
    .returning();

  return updated;
});
