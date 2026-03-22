import { eq } from "drizzle-orm";
import { db } from "../../db";
import { trips } from "../../db/schema";
import { paginationSchema } from "../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const query = await getValidatedQuery(event, paginationSchema.parse);

  const result = await db.query.trips.findMany({
    where: eq(trips.userId, session.user.id),
    with: {
      days: {
        with: {
          activities: true,
          travelSegments: true,
        },
      },
    },
    orderBy: (trips, { desc }) => [desc(trips.createdAt)],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return result;
});
