import { createHash } from "crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { trips, user as userTable } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { sendTripInviteEmail } from "../../../../lib/email"
import { upsertPendingTripMember } from "../../../../lib/trip-members"

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["editor", "viewer"]).default("editor"),
})

const INVITE_EXPIRY_DAYS = 7

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, inviteSchema.parse)

  // Only owner and editors can invite
  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  const invitedUser = await db.query.user.findFirst({
    where: eq(userTable.email, body.email),
  })

  const rawToken = crypto.randomUUID()
  const hashedToken = createHash("sha256").update(rawToken).digest("hex")
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  const baseUrl = process.env.NUXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000"
  const acceptUrl = `${baseUrl}/invite/${rawToken}`

  await upsertPendingTripMember({
    tripId: id,
    invitedUserId: invitedUser?.id ?? null,
    invitedEmail: body.email,
    role: body.role,
    invitedByUserId: session.user.id,
    inviteTokenHash: hashedToken,
    expiresAt,
  })

  try {
    console.log("[invite] Sending invite email from:", process.env.RESEND_FROM_EMAIL)
    await sendTripInviteEmail({
      to: body.email,
      inviterName: session.user.name || "Someone",
      tripDestination: trip.destination,
      role: body.role,
      acceptUrl,
      expiresAt,
    })
    console.log("[invite] Email sent successfully")
  } catch (e) {
    console.error("[invite] Failed to send email:", e)
    await logTripAction({
      tripId: id,
      userId: session.user.id,
      action: "member_invited",
      description: `Invited ${body.email} as ${body.role} (email delivery failed)`,
      metadata: { email: body.email, role: body.role, emailError: String(e) },
    })
    return {
      success: true,
      expiresAt: expiresAt.toISOString(),
      emailSent: false,
      error: "Invite created but email failed to send. Share the link manually.",
    }
  }

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "member_invited",
    description: `Invited ${body.email} as ${body.role}`,
    metadata: { email: body.email, role: body.role, expiresAt: expiresAt.toISOString() },
  })

  return { success: true, expiresAt: expiresAt.toISOString() }
})
