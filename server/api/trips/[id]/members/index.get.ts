import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { tripMembers, trips } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const access = await requireTripAccess(id, session.user.id)

  // Get all members with a tight projection of the user join — never spread the
  // full `user` row (banned, role, emailVerified, lastActiveAt, etc).
  const members = await db.query.tripMembers.findMany({
    where: eq(tripMembers.tripId, id),
    with: { user: { columns: { id: true, name: true, image: true } } },
  })

  // Also include the owner (same projection)
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
    with: { user: { columns: { id: true, name: true, image: true } } },
  })

  // Only owners see invitee emails and pending invites — for everyone else,
  // those fields would leak who-was-invited / contact info beyond what's needed.
  const isOwner = access.role === "owner"

  const ownerEntry = {
    id: "owner",
    userId: trip!.userId,
    role: "owner" as const,
    status: "active" as const,
    invitedEmail: null as string | null,
    expiresAt: null as string | null,
    user: trip!.user,
    createdAt: trip!.createdAt,
  }

  const memberEntries = members
    .filter((m) => m.status === "active" || (isOwner && m.status === "pending"))
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      invitedEmail: isOwner ? m.invitedEmail : null,
      expiresAt: m.expiresAt?.toISOString() ?? null,
      user: m.user,
      createdAt: m.createdAt,
    }))

  return [ownerEntry, ...memberEntries]
})
