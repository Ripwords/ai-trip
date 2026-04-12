import { createHash } from "crypto"
import { eq, and } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../db"
import { tripMembers, trips, user as userTable } from "../../../../db/schema"
import { uuidParamsSchema } from "../../../../utils/schemas"
import { sendTripInviteEmail } from "../../../../lib/email"

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

  // Get trip info for the email
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, id),
  })
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Check if user already exists
  const invitedUser = await db.query.user.findFirst({
    where: eq(userTable.email, body.email),
  })

  // Check if already a member (only if user exists)
  if (invitedUser) {
    const existing = await db.query.tripMembers.findFirst({
      where: and(eq(tripMembers.tripId, id), eq(tripMembers.userId, invitedUser.id)),
    })

    if (existing && existing.status === "active") {
      throw createError({ statusCode: 409, message: "This user is already a member" })
    }

    if (existing) {
      await db.delete(tripMembers).where(eq(tripMembers.id, existing.id))
    }
  }

  // Also check for existing pending invite by email (for non-registered users)
  const existingByEmail = await db.query.tripMembers.findFirst({
    where: and(
      eq(tripMembers.tripId, id),
      eq(tripMembers.invitedEmail, body.email),
      eq(tripMembers.status, "pending"),
    ),
  })
  if (existingByEmail) {
    await db.delete(tripMembers).where(eq(tripMembers.id, existingByEmail.id))
  }

  const rawToken = crypto.randomUUID()
  const hashedToken = createHash("sha256").update(rawToken).digest("hex")
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  const baseUrl = process.env.NUXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000"
  const acceptUrl = `${baseUrl}/invite/${rawToken}`

  // Create pending membership (userId is null if user doesn't exist yet)
  // Store the hashed token — the raw token is only sent via the invite URL/email
  const [member] = await db
    .insert(tripMembers)
    .values({
      tripId: id,
      userId: invitedUser?.id ?? null,
      role: body.role,
      invitedBy: session.user.id,
      invitedEmail: body.email,
      status: "pending",
      inviteToken: hashedToken,
      expiresAt,
    })
    .returning()

  // Send invite email
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
    // Still return success but warn the user
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
