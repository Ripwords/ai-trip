import { eq, and } from "drizzle-orm"
import { db } from "../../../../db"
import { tripMembers } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  // Gate on access before any DB read so non-members can't probe trip existence.
  const access = await requireTripAccess(id, session.user.id)

  if (access.role === "owner") {
    throw createError({
      statusCode: 400,
      message: "Trip owners cannot leave. Transfer ownership or delete the trip.",
    })
  }

  const member = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.tripId, id), eq(tripMembers.userId, session.user.id)),
  })

  if (!member) {
    throw createError({ statusCode: 404, message: "You are not a member of this trip" })
  }

  // Soft-delete: keep the row as audit trail and stay symmetric with the kick
  // path (members/[memberId].delete.ts → softRemoveTripMember).
  await db
    .update(tripMembers)
    .set({ status: "removed", inviteToken: null })
    .where(eq(tripMembers.id, member.id))

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "member_left",
    description: `${session.user.name || session.user.email} left the trip`,
  })

  return { success: true }
})
