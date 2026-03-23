import { db } from "../../../../db";
import { checklists } from "../../../../db/schema";
import { uuidParamsSchema, createChecklistSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const body = await readValidatedBody(event, createChecklistSchema.parse);

  await requireTripAccess(id, session.user.id, ["owner", "editor"]);

  const [checklist] = await db
    .insert(checklists)
    .values({ ...body, tripId: id })
    .returning();

  return checklist;
});
