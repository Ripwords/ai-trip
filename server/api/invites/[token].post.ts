import { createHash } from "crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { tripMembers } from "../../db/schema"

const paramsSchema = z.object({
  token: z.string().uuid(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { token } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Hash the incoming token to match the stored hash
  const hashedToken = createHash("sha256").update(token).digest("hex")

  // Find the invite
  const invite = await db.query.tripMembers.findFirst({
    where: eq(tripMembers.inviteToken, hashedToken),
  })

  if (!invite) {
    throw createError({ statusCode: 404, message: "Invite not found" })
  }

  if (invite.status === "active") {
    return { success: true, tripId: invite.tripId, message: "Already accepted" }
  }

  // Check expiration
  if (invite.expiresAt && new Date() > invite.expiresAt) {
    await db.update(tripMembers).set({ status: "expired" }).where(eq(tripMembers.id, invite.id))
    throw createError({ statusCode: 410, message: "This invite has expired" })
  }

  // Check email matches (if the invite has a specific email)
  if (
    invite.invitedEmail &&
    invite.invitedEmail.toLowerCase() !== session.user.email.toLowerCase()
  ) {
    throw createError({
      statusCode: 403,
      message:
        "This invite was sent to a different email address. Please sign in with the correct account.",
    })
  }

  // Accept the invite
  await db
    .update(tripMembers)
    .set({
      userId: session.user.id,
      status: "active",
      inviteToken: null,
    })
    .where(eq(tripMembers.id, invite.id))

  await logTripAction({
    tripId: invite.tripId,
    userId: session.user.id,
    action: "member_joined",
    description: `${session.user.name || session.user.email} joined the trip`,
  })

  return { success: true, tripId: invite.tripId }
})
