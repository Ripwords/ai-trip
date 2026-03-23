import { eq, desc, count } from "drizzle-orm";
import { db } from "../../../db";
import { activityLog } from "../../../db/schema";
import { uuidParamsSchema, paginationSchema } from "../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);
  const query = await getValidatedQuery(event, paginationSchema.parse);

  await requireTripAccess(id, session.user.id);

  const [totalResult] = await db
    .select({ count: count() })
    .from(activityLog)
    .where(eq(activityLog.tripId, id));

  const total = totalResult?.count ?? 0;

  const logs = await db.query.activityLog.findMany({
    where: eq(activityLog.tripId, id),
    with: { user: true },
    orderBy: [desc(activityLog.createdAt)],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return {
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      description: log.description,
      metadata: log.metadata,
      createdAt: log.createdAt,
      user: {
        id: log.user.id,
        name: log.user.name,
        image: log.user.image,
      },
    })),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
});
