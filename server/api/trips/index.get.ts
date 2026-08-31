import { db } from "../../db"
import { loadTripVisibility } from "../../lib/trip-visibility"
import { paginationSchema } from "../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = await getValidatedQuery(event, paginationSchema.parse)

  const { memberTripIds, condition } = await loadTripVisibility(session.user.id)
  const memberTripIdSet = new Set(memberTripIds)

  const result = await db.query.trips.findMany({
    where: condition,
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

  // shareToken is owner-only — a viewer or editor who learns the token can
  // construct the public /shared/<token> URL.
  return result.map((trip) => {
    const isOwner = trip.userId === session.user.id
    const role = isOwner ? "owner" : memberTripIdSet.has(trip.id) ? "editor" : "viewer"
    return Object.assign({}, trip, {
      _role: role,
      shareToken: isOwner ? trip.shareToken : null,
    })
  })
})
