import { and, asc, eq, gt, lt, or } from "drizzle-orm"
import { db } from "../../db"
import { trips, itineraryDays } from "../../db/schema"
import { uuidParamsSchema, updateTripSchema } from "../../utils/schemas"
import { enumerateDates } from "../../lib/dates"
import { getTripWithRelations } from "../../lib/trips"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updateTripSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  await db.transaction(async (tx) => {
    const existing = await tx.query.trips.findFirst({ where: eq(trips.id, id) })
    if (!existing) {
      throw createError({ statusCode: 404, message: "Trip not found" })
    }

    const datesChanging =
      (body.startDate !== undefined && body.startDate !== existing.startDate) ||
      (body.endDate !== undefined && body.endDate !== existing.endDate)

    await tx.update(trips).set(body).where(eq(trips.id, id))

    if (datesChanging) {
      const newStart = body.startDate ?? existing.startDate
      const newEnd = body.endDate ?? existing.endDate

      // 1. Delete out-of-range days. Activities cascade via FK.
      await tx
        .delete(itineraryDays)
        .where(
          and(
            eq(itineraryDays.tripId, id),
            or(lt(itineraryDays.date, newStart), gt(itineraryDays.date, newEnd)),
          ),
        )

      // 2. Insert missing days inside the new range.
      const remaining = await tx.query.itineraryDays.findMany({
        where: eq(itineraryDays.tripId, id),
        orderBy: [asc(itineraryDays.date)],
      })
      const remainingDates = new Set(remaining.map((d) => d.date))
      const toInsert = enumerateDates(newStart, newEnd)
        .filter((date) => !remainingDates.has(date))
        .map((date) => ({ tripId: id, date, dayNumber: 0 }))
      if (toInsert.length) {
        await tx.insert(itineraryDays).values(toInsert)
      }

      // 3. Renumber dayNumber by ascending date.
      const finalDays = await tx.query.itineraryDays.findMany({
        where: eq(itineraryDays.tripId, id),
        orderBy: [asc(itineraryDays.date)],
      })
      for (let i = 0; i < finalDays.length; i++) {
        await tx
          .update(itineraryDays)
          .set({ dayNumber: i + 1 })
          .where(eq(itineraryDays.id, finalDays[i]!.id))
      }
    }
  })

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "trip_updated",
    description: "Trip details updated",
  })

  const hydrated = await getTripWithRelations(id)
  if (!hydrated) {
    throw createError({ statusCode: 404, message: "Trip not found after update" })
  }
  return hydrated
})
