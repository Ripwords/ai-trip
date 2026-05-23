import { and, eq, ne } from "drizzle-orm"
import { createError } from "h3"
import { db as defaultDb } from "../db"
import { tripMembers } from "../db/schema"
import { logTripAction as defaultLogTripAction } from "../utils/trip-access"

type DbHandle = typeof defaultDb
type LogTripAction = typeof defaultLogTripAction

/**
 * Soft-remove a trip member: set status="removed" and clear inviteToken so any
 * stale invite link stops working. The row is preserved as an audit trail
 * alongside the activity_log entry.
 *
 * Throws a 404-shaped error if no member row matches (tripMemberId, tripId).
 */
export async function softRemoveTripMember(
  args: { tripId: string; tripMemberId: string; removerUserId: string },
  deps: { db?: DbHandle; logTripAction?: LogTripAction } = {},
): Promise<{ success: true }> {
  const db = deps.db ?? defaultDb
  const logTripAction = deps.logTripAction ?? defaultLogTripAction

  const member = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.id, args.tripMemberId), eq(tripMembers.tripId, args.tripId)),
    with: { user: true },
  })

  if (!member) {
    throw createError({ statusCode: 404, message: "Member not found" })
  }

  await db
    .update(tripMembers)
    .set({ status: "removed", inviteToken: null })
    .where(eq(tripMembers.id, args.tripMemberId))

  const memberWithUser = member as typeof member & {
    user?: { name?: string | null } | null
    invitedEmail?: string | null
    userId?: string | null
  }
  await logTripAction({
    tripId: args.tripId,
    userId: args.removerUserId,
    action: "member_removed",
    description: `Removed ${memberWithUser.user?.name || memberWithUser.invitedEmail || "a member"}`,
    metadata: { removedUserId: memberWithUser.userId ?? null },
  })

  return { success: true }
}

/**
 * Idempotently move a (tripId, invitee) pair into the "pending" invite state.
 *
 * Preferred lookup is by `invitedUserId` when the invitee is a registered user;
 * falls back to `invitedEmail` for unregistered invitees. Any non-active prior
 * row (pending, expired, or removed) is reactivated in place rather than
 * destroyed and re-inserted, so the soft-delete audit trail is preserved.
 *
 * Throws 409 if an active membership already exists.
 */
export async function upsertPendingTripMember(
  args: {
    tripId: string
    invitedUserId: string | null
    invitedEmail: string
    role: "editor" | "viewer"
    invitedByUserId: string
    inviteTokenHash: string
    expiresAt: Date
  },
  dbOverride?: DbHandle,
): Promise<{ memberId: string; reactivated: boolean }> {
  const db = dbOverride ?? defaultDb
  // Always set userId on reactivation. For the userId-matched branch this is a
  // no-op; for the email-matched branch it links a previously-unregistered row
  // to the user that has since signed up under the same email.
  const reactivationFields = {
    role: args.role,
    invitedBy: args.invitedByUserId,
    invitedEmail: args.invitedEmail,
    userId: args.invitedUserId,
    status: "pending",
    inviteToken: args.inviteTokenHash,
    expiresAt: args.expiresAt,
  } as const

  if (args.invitedUserId) {
    const existing = await db.query.tripMembers.findFirst({
      where: and(eq(tripMembers.tripId, args.tripId), eq(tripMembers.userId, args.invitedUserId)),
    })
    if (existing) {
      if (existing.status === "active") {
        throw createError({ statusCode: 409, message: "This user is already a member" })
      }
      await db.update(tripMembers).set(reactivationFields).where(eq(tripMembers.id, existing.id))
      return { memberId: existing.id, reactivated: true }
    }
  }

  const existingByEmail = await db.query.tripMembers.findFirst({
    where: and(
      eq(tripMembers.tripId, args.tripId),
      eq(tripMembers.invitedEmail, args.invitedEmail),
      ne(tripMembers.status, "active"),
    ),
  })
  if (existingByEmail) {
    await db
      .update(tripMembers)
      .set(reactivationFields)
      .where(eq(tripMembers.id, existingByEmail.id))
    return { memberId: existingByEmail.id, reactivated: true }
  }

  const [inserted] = await db
    .insert(tripMembers)
    .values({
      tripId: args.tripId,
      userId: args.invitedUserId,
      role: args.role,
      invitedBy: args.invitedByUserId,
      invitedEmail: args.invitedEmail,
      status: "pending",
      inviteToken: args.inviteTokenHash,
      expiresAt: args.expiresAt,
    })
    .returning()
  return { memberId: inserted!.id, reactivated: false }
}
