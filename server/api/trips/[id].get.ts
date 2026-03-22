import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { trips } from "../../db/schema";
import { uuidParamsSchema } from "../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.userId, session.user.id)),
    with: {
      days: {
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  return trip;
});
