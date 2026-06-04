import { eq } from "drizzle-orm"
import { db } from "../../db"
import { trips, visitedCountries } from "../../db/schema"
import { buildEffectiveVisitedCountries } from "../../lib/explore-country-state"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const [manualRows, userTrips] = await Promise.all([
    db.query.visitedCountries.findMany({
      where: eq(visitedCountries.userId, session.user.id),
      orderBy: (vc, { desc }) => [desc(vc.createdAt)],
    }),
    db.query.trips.findMany({
      where: eq(trips.userId, session.user.id),
      columns: {
        id: true,
        countryCode: true,
        destination: true,
        startDate: true,
        endDate: true,
        status: true,
        exploreSuppressedAt: true,
      },
    }),
  ])

  return buildEffectiveVisitedCountries({ manualRows, trips: userTrips })
})
