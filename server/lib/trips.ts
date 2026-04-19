import { eq } from "drizzle-orm"
import { db } from "../db"
import { trips } from "../db/schema"

/**
 * Fetch a trip with its full relational payload (days → activities + travelSegments).
 * Returns `undefined` if the trip does not exist. Shape matches `GET /api/trips/[id]`
 * so the client-side `TripResponse` type fits unchanged.
 */
export async function getTripWithRelations(tripId: string) {
  return db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: {
            orderBy: (activities, { asc }) => [asc(activities.sortOrder)],
          },
          travelSegments: true,
        },
      },
    },
  })
}
