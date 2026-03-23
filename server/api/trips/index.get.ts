import { eq, or, inArray } from "drizzle-orm";
import { db } from "../../db";
import { trips, tripMembers } from "../../db/schema";
import { paginationSchema } from "../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const query = await getValidatedQuery(event, paginationSchema.parse);

  // Get trip IDs where user is a member
  const memberships = await db.query.tripMembers.findMany({
    where: eq(tripMembers.userId, session.user.id),
    columns: { tripId: true },
  });
  const memberTripIds = memberships.map((m) => m.tripId);

  // Fetch own trips + shared trips
  const result = await db.query.trips.findMany({
    where: memberTripIds.length > 0
      ? or(eq(trips.userId, session.user.id), inArray(trips.id, memberTripIds))
      : eq(trips.userId, session.user.id),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
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

  // Tag each trip with the user's role
  return result.map((trip) => ({
    ...trip,
    _role: trip.userId === session.user.id ? "owner" : (
      memberships.find((m) => m.tripId === trip.id) ? "editor" : "viewer"
    ),
  }));
});
