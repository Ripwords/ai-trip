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
  // The token comes from a link the user may have truncated when copying, so a
  // malformed one is an ordinary occurrence and must read as a sentence, not as
  // a Zod issue array. See server/utils/friendly-error.ts.
  const { token } = await getValidatedRouterParams(event, (params) =>
    parseParamsOrFail(
      params,
      paramsSchema.parse,
      "That invite link isn't valid. Ask for a fresh one, or check you copied the whole link.",
    ),
  )

  // Hash the incoming token to match the stored hash
  const hashedToken = createHash("sha256").update(token).digest("hex")

  // Find the invite
  const invite = await db.query.tripMembers.findFirst({
    where: eq(tripMembers.inviteToken, hashedToken),
  })

  if (!invite) {
    // The session-create auto-accept hook may have already activated this invite
    // and cleared the token. The previous fallback queried "most recent active
    // membership for this email" with no trip scoping, so it returned the wrong
    // tripId for users who were members of multiple trips. The auto-accept hook
    // already redirects on first sign-in; if the user revisits a stale invite
    // URL later, return 410 Gone rather than guess.
    throw createError({
      statusCode: 410,
      message: "This invite has already been used. You'll find the trip on your dashboard.",
    })
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
