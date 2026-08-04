import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { activities, tripMembers, trips } from "../db/schema"

/**
 * Validate the two foreign references on an expense body against the trip it
 * is being written to.
 *
 * POST performed these checks inline; PUT performed neither, so an editor
 * could re-point an expense at an activity belonging to a *different* trip, or
 * set `paidById` to someone who is not a member — corrupting settlement, which
 * splits by member. Extracted here so both handlers share one implementation
 * and cannot drift again.
 *
 * `undefined` means "not being changed" and is skipped; `null` clears the
 * reference and needs no validation.
 */
export async function assertExpenseRefs(
  tripId: string,
  refs: { activityId?: string | null; paidById?: string | null },
): Promise<void> {
  if (refs.activityId) {
    const activity = await db.query.activities.findFirst({
      where: eq(activities.id, refs.activityId),
      with: { day: true },
    })
    if (!activity || activity.day.tripId !== tripId) {
      throw createError({ statusCode: 404, message: "Activity not found" })
    }
  }

  if (refs.paidById) {
    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { userId: true },
    })
    if (!trip) throw createError({ statusCode: 404, message: "Trip not found" })

    if (refs.paidById !== trip.userId) {
      const member = await db.query.tripMembers.findFirst({
        where: and(
          eq(tripMembers.tripId, tripId),
          eq(tripMembers.userId, refs.paidById),
          eq(tripMembers.status, "active"),
        ),
      })
      if (!member) {
        throw createError({ statusCode: 400, message: "Paid-by user is not a member of this trip" })
      }
    }
  }
}
