import { eq, or, inArray, and } from "drizzle-orm"
import { db } from "../../db"
import { trips, tripMembers } from "../../db/schema"
import { paginationSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = await getValidatedQuery(event, paginationSchema.parse)

  // Only include memberships the user has actually accepted — otherwise pending invites
  // show up on the dashboard but requireTripAccess rejects them as "Trip not found".
  const memberships = await db.query.tripMembers.findMany({
    where: and(eq(tripMembers.userId, session.user.id), eq(tripMembers.status, "active")),
    columns: { tripId: true },
  })
  const memberTripIds = memberships.map((m) => m.tripId)

  // Fetch own trips + shared trips
  const result = await db.query.trips.findMany({
    where:
      memberTripIds.length > 0
        ? or(eq(trips.userId, session.user.id), inArray(trips.id, memberTripIds))
        : eq(trips.userId, session.user.id),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          activities: true,
          travelSegments: true,
        },
      },
    },
    orderBy: (trips, { desc }) => [desc(trips.createdAt)],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  })

  // Tag each trip with the user's role. shareToken is owner-only — a viewer or
  // editor who learns the token can construct the public /shared/<token> URL.
  return result.map((trip) => {
    const isOwner = trip.userId === session.user.id
    const role = isOwner
      ? "owner"
      : memberships.find((m) => m.tripId === trip.id)
        ? "editor"
        : "viewer"
    return Object.assign({}, trip, {
      _role: role,
      shareToken: isOwner ? trip.shareToken : null,
    })
  })
})
