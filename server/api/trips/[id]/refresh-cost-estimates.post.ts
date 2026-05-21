import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm"
import { db } from "../../../db"
import { trips, activities, itineraryDays } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { deriveCostFromPlace } from "../../../lib/cost-from-place"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }
  const currencyCode = trip.currencyCode || "USD"

  // Find every activity on this trip that has a placeId but no
  // costEstimate — these are the candidates Google Maps may have a
  // priceRange for.
  const days = await db.query.itineraryDays.findMany({
    where: eq(itineraryDays.tripId, id),
    columns: { id: true },
  })
  const dayIds = days.map((d) => d.id)
  if (dayIds.length === 0) {
    return { updated: 0, candidates: 0 }
  }

  const candidates = await db.query.activities.findMany({
    where: and(
      inArray(activities.itineraryDayId, dayIds),
      isNotNull(activities.placeId),
      isNull(activities.costEstimate),
    ),
    columns: { id: true, placeId: true },
  })

  // Fan out: getPlaceDetails is cached 7 days, exchange rates 6 hours.
  // Worst case the first refresh on a fresh trip does ~N Google calls
  // in parallel; subsequent refreshes are mostly cache hits.
  const derived = await Promise.allSettled(
    candidates.map(async (a) => {
      if (!a.placeId) return null
      const cost = await deriveCostFromPlace(a.placeId, currencyCode)
      return cost ? { id: a.id, cost } : null
    }),
  )

  const updates = derived
    .filter(
      (r): r is PromiseFulfilledResult<{ id: string; cost: string }> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value)

  await Promise.all(
    updates.map((u) =>
      db.update(activities).set({ costEstimate: u.cost }).where(eq(activities.id, u.id)),
    ),
  )

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "cost_estimates_refreshed",
    description: `Refreshed cost estimates from Google Maps for ${updates.length} activit${
      updates.length === 1 ? "y" : "ies"
    }`,
    metadata: { updated: updates.length, candidates: candidates.length },
  })

  return { updated: updates.length, candidates: candidates.length }
})
