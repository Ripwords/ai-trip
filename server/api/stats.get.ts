import { eq, sql, and, inArray } from "drizzle-orm"
import { db } from "../db"
import {
  trips,
  activities,
  itineraryDays,
  travelSegments,
  visitedCountries,
  flights,
  tripMembers,
} from "../db/schema"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const userId = session.user.id

  // Get all trip IDs the user owns or is an active member of. Removed
  // memberships are excluded so a kicked user's stats no longer count the trip.
  const memberships = await db.query.tripMembers.findMany({
    where: and(eq(tripMembers.userId, userId), eq(tripMembers.status, "active")),
    columns: { tripId: true },
  })
  const memberTripIds = memberships.map((m) => m.tripId)

  const userTrips = await db.query.trips.findMany({
    where:
      memberTripIds.length > 0
        ? sql`${trips.userId} = ${userId} OR ${trips.id} IN ${memberTripIds}`
        : eq(trips.userId, userId),
    columns: { id: true, startDate: true, endDate: true },
  })

  const tripIds = userTrips.map((t) => t.id)
  const totalTrips = tripIds.length

  // Count completed trips
  const today = new Date().toISOString().split("T")[0]!
  const completedTrips = userTrips.filter((t) => t.endDate < today).length

  // Total days of travel
  const totalDays = userTrips.reduce((sum, t) => {
    const s = new Date(t.startDate)
    const e = new Date(t.endDate)
    return sum + Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  }, 0)

  // Parallelize independent queries
  const [countries, days, [flightResult]] = await Promise.all([
    // Countries visited
    db.query.visitedCountries.findMany({
      where: and(eq(visitedCountries.userId, userId), eq(visitedCountries.visitType, "visited")),
      columns: { countryCode: true },
    }),
    // Itinerary day IDs for activity/distance stats
    tripIds.length > 0
      ? db.query.itineraryDays.findMany({
          where: inArray(itineraryDays.tripId, tripIds),
          columns: { id: true },
        })
      : Promise.resolve([]),
    // Total flights
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(flights)
      .where(eq(flights.userId, userId)),
  ])

  const countriesVisited = countries.length
  const dayIds = days.map((d) => d.id)

  let totalActivities = 0
  let totalDistanceKm = 0
  const totalFlights = flightResult?.count ?? 0

  if (dayIds.length > 0) {
    const [[actResult], [distResult]] = await Promise.all([
      // Total activities
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(activities)
        .where(inArray(activities.itineraryDayId, dayIds)),
      // Total distance from travel segments
      db
        .select({ total: sql<number>`coalesce(sum(${travelSegments.distanceMeters}), 0)::int` })
        .from(travelSegments)
        .where(inArray(travelSegments.itineraryDayId, dayIds)),
    ])
    totalActivities = actResult?.count ?? 0
    totalDistanceKm = Math.round((distResult?.total ?? 0) / 1000)
  }

  return {
    totalTrips,
    completedTrips,
    totalDays,
    countriesVisited,
    totalActivities,
    totalDistanceKm,
    totalFlights,
  }
})
