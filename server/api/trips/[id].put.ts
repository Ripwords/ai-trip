import { and, asc, eq, gt, lt, or } from "drizzle-orm"
import { countryByAlpha2 } from "~/data/countries"
import { db } from "../../db"
import { trips, itineraryDays } from "../../db/schema"
import { uuidParamsSchema, updateTripSchema } from "../../utils/schemas"
import { enumerateDates } from "../../lib/dates"
import { getTripWithRelations } from "../../lib/trips"
import { lockTripForStayWrite, reconcileTripStays } from "../../lib/booking-sync"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, updateTripSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const existing = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!existing) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // If countryCode or name is being changed, keep the legacy `destination`
  // column in sync (`name ?? country.name`) so old readers keep working.
  // Validate the country code upfront.
  const patch: Record<string, unknown> = { ...body }
  if (body.countryCode !== undefined) {
    const country = countryByAlpha2.get(body.countryCode)
    if (!country) {
      throw createError({ statusCode: 400, message: "Unknown country" })
    }
    patch.countryCode = country.alpha2
  }
  if (body.countryCode !== undefined || body.name !== undefined) {
    const nextCountryCode = body.countryCode ?? existing.countryCode
    const nextName = body.name === undefined ? existing.name : body.name?.trim() || null
    patch.name = nextName
    const nextCountry = nextCountryCode ? countryByAlpha2.get(nextCountryCode) : null
    patch.destination = nextName ?? nextCountry?.name ?? existing.destination
  }
  if (body.countryCode !== undefined && body.countryCode !== existing.countryCode) {
    patch.exploreSuppressedAt = null
  }

  const datesChanging =
    (body.startDate !== undefined && body.startDate !== existing.startDate) ||
    (body.endDate !== undefined && body.endDate !== existing.endDate)

  if (!datesChanging) {
    // Simple path: trip fields only, no day reconciliation.
    await db.update(trips).set(patch).where(eq(trips.id, id))
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

    // Apply atomically. `db` is the neon-serverless driver (websocket Pool) in
    // every environment and supports real transactions; the previous
    // `import.meta.dev` split fell back to `db.batch`, which exists only on the
    // neon-*http* driver and would have thrown in production.
    await db.transaction(async (tx) => {
      // Before the day writes, never after — see `lockTripForStayWrite`.
      if (hasDeletes) await lockTripForStayWrite(tx, id)

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
      await tx.update(trips).set(patch).where(eq(trips.id, id))

      // Resizing the trip resizes its stays. Deleting days deletes nights out
      // of a stay's run, and without this the stay keeps a `check_in`/
      // `check_out` — and a mirrored booking — covering dates that are no
      // longer in the trip at all. Same transaction as the resize: a stay that
      // outlived its days is exactly the drift `accommodation_*` being a
      // read-cache is supposed to make impossible.
      if (hasDeletes) {
        await reconcileTripStays(tx, id, session.user.id)
      }
    })
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
