import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { trips, activities, expenses, itineraryDays } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"

const bodySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  if (body.from === body.to) {
    return { converted: false, rate: 1 }
  }

  // Fetch exchange rate BEFORE opening the transaction so a slow/failing
  // upstream call doesn't hold a DB transaction open.
  let rate: number
  try {
    const rateResponse = await $fetch<{ rate: number }>(
      `https://api.frankfurter.dev/v2/rate/${body.from}/${body.to}`,
    )
    rate = rateResponse.rate
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid exchange rate: ${rate}`)
    }
  } catch (e) {
    throw createError({
      statusCode: 502,
      message: "Could not fetch exchange rate. Please try again.",
      cause: e,
    })
  }

  // All mutations run in a single transaction so a mid-flight failure can't
  // leave the trip in a half-converted state.
  await db.transaction(async (tx) => {
    // Lock the trip row and verify the client's `from` matches what's actually
    // stored. Protects against concurrent conversions (collaborator A converts
    // USD→EUR while B's stale client still thinks the trip is USD and submits
    // USD→JPY — without this check, B would corrupt every cost on the trip).
    const [current] = await tx
      .select({ currencyCode: trips.currencyCode })
      .from(trips)
      .where(eq(trips.id, id))
      .for("update")
    if (!current) {
      throw createError({ statusCode: 404, message: "Trip not found" })
    }
    if (current.currencyCode !== body.from) {
      throw createError({
        statusCode: 409,
        message: `Trip currency is already ${current.currencyCode}, not ${body.from}. Refresh and try again.`,
      })
    }

    // Fetch day IDs once, reuse for both activity-column updates.
    const dayRows = await tx
      .select({ id: itineraryDays.id })
      .from(itineraryDays)
      .where(eq(itineraryDays.tripId, id))
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
      .set({
        amount: sql`ROUND(${expenses.amount}::numeric * ${rate}::numeric, 2)`,
      })
      .where(eq(expenses.tripId, id))

    await tx
      .update(trips)
      .set({
        budget: sql`CASE WHEN ${trips.budget} IS NULL THEN NULL ELSE ROUND(${trips.budget}::numeric * ${rate}::numeric, 2) END`,
        currencyCode: body.to,
      })
      .where(eq(trips.id, id))
  })

  return { converted: true, rate }
})
