import { eq, and } from "drizzle-orm"
import { db } from "../db"
import { trips, tripMembers, activityLog } from "../db/schema"

type TripRole = "owner" | "editor" | "viewer"

interface TripAccess {
  tripId: string
  userId: string
  role: TripRole
}

/**
 * Check if a user has access to a trip.
 * Returns the user's role, or throws 404 if no access.
 */
export async function requireTripAccess(
  tripId: string,
  userId: string,
  requiredRole?: TripRole | TripRole[],
): Promise<TripAccess> {
  // Check if user is the trip owner
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  })

  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  let role: TripRole

  if (trip.userId === userId) {
    role = "owner"
  } else {
    // Check trip_members table
    const member = await db.query.tripMembers.findFirst({
      where: and(
        eq(tripMembers.tripId, tripId),
        eq(tripMembers.userId, userId),
        eq(tripMembers.status, "active"),
      ),
    })

    if (!member) {
      throw createError({ statusCode: 404, message: "Trip not found" })
    }

    role = member.role as TripRole
  }

  // Check required role
  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
    if (!allowed.includes(role)) {
      throw createError({ statusCode: 403, message: "You don't have permission to do this" })
    }
  }

  return { tripId, userId, role }
}

/**
 * Log an action to the activity log.
 */
export async function logTripAction(params: {
  tripId: string
  userId: string
  action: string
  description: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await db.insert(activityLog).values({
    tripId: params.tripId,
    userId: params.userId,
    action: params.action,
    description: params.description,
    metadata: params.metadata,
  })
}
