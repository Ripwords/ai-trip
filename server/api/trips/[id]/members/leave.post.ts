import { eq, and } from "drizzle-orm";
import { db } from "../../../../db";
import { trips, tripMembers } from "../../../../db/schema";
import { uuidParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  // Check if user is the owner — owners can't leave their own trip
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  });

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" });
  }

  if (trip.userId === session.user.id) {
    throw createError({ statusCode: 400, message: "Trip owners cannot leave. Transfer ownership or delete the trip." });
  }

  // Find and delete membership
  const member = await db.query.tripMembers.findFirst({
    where: and(
      eq(tripMembers.tripId, id),
      eq(tripMembers.userId, session.user.id),
    ),
  });

  if (!member) {
    throw createError({ statusCode: 404, message: "You are not a member of this trip" });
  }

  await db.delete(tripMembers).where(eq(tripMembers.id, member.id));

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "member_left",
    description: `${session.user.name || session.user.email} left the trip`,
  });

  return { success: true };
});
