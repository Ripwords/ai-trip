import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { tripMembers, trips } from "../../../../db/schema";
import { uuidParamsSchema } from "../../../../utils/schemas";

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse);

  const access = await requireTripAccess(id, session.user.id);

  // Get all members with user info
  const members = await db.query.tripMembers.findMany({
    where: eq(tripMembers.tripId, id),
    with: { user: true },
  });

  // Also include the owner
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    with: { user: true },
  });

  const ownerEntry = {
    id: "owner",
    userId: trip!.userId,
    role: "owner" as const,
    status: "active" as const,
    invitedEmail: null as string | null,
    expiresAt: null as string | null,
    user: trip!.user,
    createdAt: trip!.createdAt,
  };

  // Only owners can see pending invites
  const showPending = access.role === "owner";

  const memberEntries = members
    .filter((m) => m.status === "active" || (showPending && m.status === "pending"))
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      invitedEmail: m.invitedEmail,
      expiresAt: m.expiresAt?.toISOString() ?? null,
      user: m.user,
      createdAt: m.createdAt,
    }));

  return [ownerEntry, ...memberEntries];
});
