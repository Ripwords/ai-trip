import { and, eq, inArray, or, type SQL } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { tripMembers, trips } from "../db/schema"

type DbHandle = typeof defaultDb

export interface TripVisibility {
  /**
   * Trips the user was invited to and accepted. Owned trips are not in here —
   * the owner has no `trip_members` row.
   */
  memberTripIds: string[]
  /** Condition selecting every trip the user may see, for a query over `trips`. */
  condition: SQL
}

/**
 * Which trips a user can see: the ones they own plus the ones they are an
 * *active* member of. Pending invites are excluded, because they show on the
 * dashboard while `requireTripAccess` still rejects them as "Trip not found",
 * and removed members must stop seeing the trip at all.
 *
 * Returns the membership ids alongside the condition so a caller that also
 * needs to label each trip with the user's role does not query them twice.
 */
export async function loadTripVisibility(
  userId: string,
  deps: { db?: DbHandle } = {},
): Promise<TripVisibility> {
  const memberships = await (deps.db ?? defaultDb).query.tripMembers.findMany({
    where: and(eq(tripMembers.userId, userId), eq(tripMembers.status, "active")),
    columns: { tripId: true },
  })
  const memberTripIds = memberships.map((m) => m.tripId)

  const owned = eq(trips.userId, userId)
  if (memberTripIds.length === 0) return { memberTripIds, condition: owned }

  // `or` is typed `SQL | undefined` for the all-arguments-undefined case, which
  // cannot happen here; falling back to `owned` narrows without widening access.
  return {
    memberTripIds,
    condition: or(owned, inArray(trips.id, memberTripIds)) ?? owned,
  }
}
