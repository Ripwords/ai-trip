import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { documents } from "../../../../db/schema";
import { uuidParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  await requireTripAccess(id, session.user.id);

  return db.query.documents.findMany({
    where: eq(documents.tripId, id),
    with: {
      uploadedBy: {
        columns: { id: true, name: true, image: true },
      },
    },
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  });
});
