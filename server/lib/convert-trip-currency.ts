import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { db } from "../db"
import { trips, activities, expenses, reservations, itineraryDays } from "../db/schema"

/** Drizzle transaction handle, structurally (also satisfied by `db` itself). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Multiply every money column on a trip by `rate` and stamp the new currency.
 * Runs inside the caller's transaction so a mid-flight failure can't leave the
 * trip half-converted. Covers: activity costEstimate/actualCost, expenses,
 * reservations, and the trip budget.
 */
export async function convertTripMoney(
  tx: Tx,
  tripId: string,
  rate: number,
  toCurrency: string,
): Promise<void> {
  const dayRows = await tx
    .select({ id: itineraryDays.id })
    .from(itineraryDays)
    .where(eq(itineraryDays.tripId, tripId))
  const dayIds = dayRows.map((d) => d.id)

  if (dayIds.length > 0) {
    await tx
      .update(activities)
      .set({
        costEstimate: sql`ROUND(${activities.costEstimate}::numeric * ${rate}::numeric, 2)`,
      })
      .where(and(inArray(activities.itineraryDayId, dayIds), isNotNull(activities.costEstimate)))

    await tx
      .update(activities)
      .set({
        actualCost: sql`ROUND(${activities.actualCost}::numeric * ${rate}::numeric, 2)`,
      })
      .where(and(inArray(activities.itineraryDayId, dayIds), isNotNull(activities.actualCost)))
  }

  await tx
    .update(expenses)
    .set({ amount: sql`ROUND(${expenses.amount}::numeric * ${rate}::numeric, 2)` })
    .where(eq(expenses.tripId, tripId))

  await tx
    .update(reservations)
    .set({ amount: sql`ROUND(${reservations.amount}::numeric * ${rate}::numeric, 2)` })
    .where(and(eq(reservations.tripId, tripId), isNotNull(reservations.amount)))

  await tx
    .update(trips)
    .set({
      budget: sql`CASE WHEN ${trips.budget} IS NULL THEN NULL ELSE ROUND(${trips.budget}::numeric * ${rate}::numeric, 2) END`,
      currencyCode: toCurrency,
    })
    .where(eq(trips.id, tripId))
}
