import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { activities, tripMembers, trips } from "../db/schema"

/** Database lookups, injectable so the rules below can be unit-tested. */
export interface ExpenseRefDeps {
  /** The trip an activity belongs to, or null when it doesn't exist. */
  findActivityTripId: (activityId: string) => Promise<string | null>
  /** The trip's owner id, or null when the trip doesn't exist. */
  findTripOwnerId: (tripId: string) => Promise<string | null>
  isActiveMember: (tripId: string, userId: string) => Promise<boolean>
}

const defaultDeps: ExpenseRefDeps = {
  findActivityTripId: async (activityId) => {
    const activity = await db.query.activities.findFirst({
      where: eq(activities.id, activityId),
      with: { day: true },
    })
    return activity?.day.tripId ?? null
  },
  findTripOwnerId: async (tripId) => {
    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { userId: true },
    })
    return trip?.userId ?? null
  },
  isActiveMember: async (tripId, userId) => {
    const member = await db.query.tripMembers.findFirst({
      where: and(
        eq(tripMembers.tripId, tripId),
        eq(tripMembers.userId, userId),
        eq(tripMembers.status, "active"),
      ),
    })
    return member != null
  },
}

/**
 * Validate the two foreign references on an expense body against the trip it
 * is being written to.
 *
 * POST performed these checks inline; PUT performed neither, so an editor
 * could re-point an expense at an activity belonging to a *different* trip, or
 * set `paidById` to someone who is not a member — corrupting settlement, which
 * splits by member. Shared by both handlers so they cannot drift again.
 *
 * `undefined` means "not being changed" and is skipped; `null` clears the
 * reference and needs no validation.
 */
export async function assertExpenseRefs(
  tripId: string,
  refs: { activityId?: string | null; paidById?: string | null },
  deps: ExpenseRefDeps = defaultDeps,
): Promise<void> {
  if (refs.activityId) {
    const activityTripId = await deps.findActivityTripId(refs.activityId)
    if (activityTripId !== tripId) {
      throw createError({ statusCode: 404, message: "Activity not found" })
    }
  }

  if (refs.paidById) {
    const ownerId = await deps.findTripOwnerId(tripId)
    if (!ownerId) throw createError({ statusCode: 404, message: "Trip not found" })

    // Owners have no tripMembers row, so they must be allowed explicitly.
    if (refs.paidById !== ownerId && !(await deps.isActiveMember(tripId, refs.paidById))) {
      throw createError({ statusCode: 400, message: "Paid-by user is not a member of this trip" })
    }
  }
}
