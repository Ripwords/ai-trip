import { eq } from "drizzle-orm";
import { db } from "../../../../../db";
import { activities, activityVotes } from "../../../../../db/schema";
import { activityIdParamsSchema } from "../../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id, activityId } = await getValidatedRouterParams(event, activityIdParamsSchema.parse);

  await requireTripAccess(id, session.user.id);

  // Verify activity belongs to trip
  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: { day: true },
  });
  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" });
  }

  const votes = await db.query.activityVotes.findMany({
    where: eq(activityVotes.activityId, activityId),
    with: { user: { columns: { name: true, image: true } } },
  });

  const upVotes = votes.filter((v) => v.vote === "up").length;
  const downVotes = votes.filter((v) => v.vote === "down").length;
  const myVote = votes.find((v) => v.userId === session.user.id)?.vote ?? null;

  return { upVotes, downVotes, myVote };
});
