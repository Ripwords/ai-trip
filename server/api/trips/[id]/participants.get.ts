import { eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { activities, activityParticipants, itineraryDays } from "../../../db/schema";
import { uuidParamsSchema } from "../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  await requireTripAccess(id, session.user.id);

  // Get all activity IDs for this trip
  const days = await db.query.itineraryDays.findMany({
    where: eq(itineraryDays.tripId, id),
    columns: { id: true },
  });

  if (days.length === 0) return {};

  const dayIds = days.map((d) => d.id);
  const tripActivities = await db.query.activities.findMany({
    where: inArray(activities.itineraryDayId, dayIds),
    columns: { id: true },
  });

  if (tripActivities.length === 0) return {};

  const activityIds = tripActivities.map((a) => a.id);
  const participants = await db.query.activityParticipants.findMany({
    where: inArray(activityParticipants.activityId, activityIds),
    with: {
      user: {
        columns: { id: true, name: true, image: true },
      },
    },
  });

  // Group by activityId
  const grouped: Record<string, { userId: string; name: string; image: string | null }[]> = {};
  for (const p of participants) {
    if (!grouped[p.activityId]) grouped[p.activityId] = [];
    grouped[p.activityId]!.push({
      userId: p.user.id,
      name: p.user.name,
      image: p.user.image,
    });
  }

  return grouped;
});
