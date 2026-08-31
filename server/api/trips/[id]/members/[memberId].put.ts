import "zod/compile"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { tripMembers } from "../../../../db/schema"

const memberIdParamsSchema = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
})

const updateMemberSchema = z.object({
  role: z.enum(["editor", "viewer"]),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, memberId } = await getValidatedRouterParams(event, memberIdParamsSchema.parse)
  const body = await readValidatedBody(event, updateMemberSchema.parse)

  // Only owner can change roles
  await requireTripAccess(id, session.user.id, ["owner"])

  const member = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.id, memberId), eq(tripMembers.tripId, id)),
  })

  if (!member) {
    throw createError({ statusCode: 404, message: "Member not found" })
  }

  if (member.userId === session.user.id) {
    throw createError({ statusCode: 400, message: "Cannot change your own role" })
  }

  if (member.status !== "active") {
    throw createError({ statusCode: 400, message: "Can only change role of active members" })
  }

  const [updated] = await db
    .update(tripMembers)
    .set({ role: body.role })
    .where(eq(tripMembers.id, memberId))
    .returning()

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "member_role_changed",
    description: `Changed role to ${body.role}`,
    metadata: { memberId, newRole: body.role },
  })

  return updated
})
