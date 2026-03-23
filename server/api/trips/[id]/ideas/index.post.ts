import { db } from "../../../../db";
import { tripIdeas } from "../../../../db/schema";
import { uuidParamsSchema, createIdeaSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, createIdeaSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  const [idea] = await db
    .insert(tripIdeas)
    .values({ ...body, tripId: id })
    .returning();

  return idea;
});
