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

  const existing = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  const datesChanging =
    (body.startDate !== undefined && body.startDate !== existing.startDate) ||
    (body.endDate !== undefined && body.endDate !== existing.endDate)

  if (!datesChanging) {
    // Simple path: trip fields only, no day reconciliation.
    await db.update(trips).set(body).where(eq(trips.id, id))
  } else {
    const newStart = body.startDate ?? existing.startDate
    const newEnd = body.endDate ?? existing.endDate

    // Snapshot the current days so we can diff against the target range.
    const existingDays = await db.query.itineraryDays.findMany({
      where: eq(itineraryDays.tripId, id),
      orderBy: [asc(itineraryDays.date)],
    })
    const existingByDate = new Map(existingDays.map((d) => [d.date, d]))
    const targetDates = enumerateDates(newStart, newEnd)
    const targetSet = new Set(targetDates)

    const hasDeletes = existingDays.some((d) => !targetSet.has(d.date))

    // Insert missing days with their final dayNumber upfront — avoids a
    // second-pass renumber.
    const toInsert = targetDates
      .map((date, i) => ({ date, dayNumber: i + 1 }))
      .filter((x) => !existingByDate.has(x.date))
      .map((x) => ({ tripId: id, date: x.date, dayNumber: x.dayNumber }))

    // Renumber only kept days whose position shifted.
    const toRenumber: { id: string; dayNumber: number }[] = []
    for (let i = 0; i < targetDates.length; i++) {
      const kept = existingByDate.get(targetDates[i]!)
      if (kept && kept.dayNumber !== i + 1) {
        toRenumber.push({ id: kept.id, dayNumber: i + 1 })
      }
    }

    // Apply atomically. neon-http (prod) doesn't support db.transaction but
    // does support db.batch — which wraps the statement array in a single
    // atomic SQL transaction. node-postgres (dev) is the reverse.
    if (import.meta.dev) {
      await db.transaction(async (tx) => {
        if (hasDeletes) {
          await tx
            .delete(itineraryDays)
            .where(
              and(
                eq(itineraryDays.tripId, id),
                or(lt(itineraryDays.date, newStart), gt(itineraryDays.date, newEnd)),
              ),
            )
        }
        if (toInsert.length > 0) {
          await tx.insert(itineraryDays).values(toInsert)
        }
        for (const u of toRenumber) {
          await tx
            .update(itineraryDays)
            .set({ dayNumber: u.dayNumber })
            .where(eq(itineraryDays.id, u.id))
        }
        await tx.update(trips).set(body).where(eq(trips.id, id))
      })
    } else {
      const ops: unknown[] = []
      if (hasDeletes) {
        ops.push(
          db
            .delete(itineraryDays)
            .where(
              and(
                eq(itineraryDays.tripId, id),
                or(lt(itineraryDays.date, newStart), gt(itineraryDays.date, newEnd)),
              ),
            ),
        )
      }
      if (toInsert.length > 0) {
        ops.push(db.insert(itineraryDays).values(toInsert))
      }
      for (const u of toRenumber) {
        ops.push(
          db
            .update(itineraryDays)
            .set({ dayNumber: u.dayNumber })
            .where(eq(itineraryDays.id, u.id)),
        )
      }
      ops.push(db.update(trips).set(body).where(eq(trips.id, id)))

      // db.batch wraps the array in a single atomic SQL transaction on the
      // neon-http driver. It is not present on node-postgres, so this branch
      // is guarded by `!import.meta.dev`.
      const batchDb = db as unknown as {
        batch: (ops: readonly [unknown, ...unknown[]]) => Promise<unknown>
      }
      await batchDb.batch(ops as [unknown, ...unknown[]])
    }
  }

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
