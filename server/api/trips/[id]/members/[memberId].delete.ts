import { eq, and } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { tripMembers } from "../../../../db/schema"

const paramsSchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, memberId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Only owner can remove members
  await requireTripAccess(id, session.user.id, ["owner"])

  const member = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.id, memberId), eq(tripMembers.tripId, id)),
    with: { user: true },
  })

  if (!member) {
    throw createError({ statusCode: 404, message: "Member not found" })
  }

  await db.delete(tripMembers).where(eq(tripMembers.id, memberId))

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "member_removed",
    description: `Removed ${member.user?.name || member.invitedEmail || "a member"}`,
    metadata: { removedUserId: member.userId },
  })

  return { success: true }
})
