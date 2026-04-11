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

  // Get all trip IDs the user owns or is member of
  const memberships = await db.query.tripMembers.findMany({
    where: eq(tripMembers.userId, userId),
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

  // Countries visited
  const countries = await db.query.visitedCountries.findMany({
    where: and(eq(visitedCountries.userId, userId), eq(visitedCountries.visitType, "visited")),
    columns: { countryCode: true },
  })
  const countriesVisited = countries.length

  // Activities count + distance travelled (only if user has trips)
  let totalActivities = 0
  let totalDistanceKm = 0
  let totalFlights = 0

  if (tripIds.length > 0) {
    // Get all itinerary day IDs for the user's trips
    const days = await db.query.itineraryDays.findMany({
      where: inArray(itineraryDays.tripId, tripIds),
      columns: { id: true },
    })
    const dayIds = days.map((d) => d.id)

    if (dayIds.length > 0) {
      // Total activities
      const [actResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(activities)
        .where(inArray(activities.itineraryDayId, dayIds))
      totalActivities = actResult?.count ?? 0

      // Total distance from travel segments
      const [distResult] = await db
        .select({ total: sql<number>`coalesce(sum(${travelSegments.distanceMeters}), 0)::int` })
        .from(travelSegments)
        .where(inArray(travelSegments.itineraryDayId, dayIds))
      totalDistanceKm = Math.round((distResult?.total ?? 0) / 1000)
    }
  }

  // Total flights
  const [flightResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flights)
    .where(eq(flights.userId, userId))
  totalFlights = flightResult?.count ?? 0

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
