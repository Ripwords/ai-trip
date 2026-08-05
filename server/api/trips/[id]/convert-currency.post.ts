import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { expenses, trips } from "../../../db/schema"
import { currencyCodeSchema, uuidParamsSchema } from "../../../utils/schemas"
import { getExchangeRate } from "../../../utils/exchange-rate"
import { convertTripMoney, resolveExpenseProjectionRates } from "../../../lib/convert-trip-currency"

const bodySchema = z.object({
  // Was `z.string().length(3)`, which accepts "1a3" and would store it as the
  // trip's currency — see server/utils/schemas.ts.
  from: currencyCodeSchema,
  to: currencyCodeSchema,
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  if (body.from === body.to) {
    return { converted: false, rate: 1 }
  }

  // Fetch exchange rates BEFORE opening the transaction so a slow/failing
  // upstream call doesn't hold a DB transaction open. getExchangeRate is
  // cached (6h) and validates the rate (finite, > 0).
  const rate = await getExchangeRate(body.from, body.to)
  if (rate == null) {
    throw createError({
      statusCode: 502,
      message: "Could not fetch exchange rate. Please try again.",
    })
  }

  // Expenses are re-projected from their own immutable `amount`, so each
  // distinct expense currency needs its own rate into the target — a trip with
  // a ¥3,200 lunch and a $40 dinner cannot be converted by any single rate.
  // Resolved out here, and a failure aborts before anything is written.
  const expenseCurrencyRows = await db
    .selectDistinct({ currencyCode: expenses.currencyCode })
    .from(expenses)
    .where(eq(expenses.tripId, id))
  const expenseRates = await resolveExpenseProjectionRates(
    expenseCurrencyRows.map((r) => r.currencyCode),
    body.to,
    getExchangeRate,
  )

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

    await convertTripMoney(tx, id, {
      fromCurrency: current.currencyCode,
      toCurrency: body.to,
      rate,
      expenseRates,
    })
  })

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "trip_currency_converted",
    description: `Trip currency changed from ${body.from} to ${body.to}`,
    // Nothing recorded currency changes before this — not this route, and not
    // `PUT /api/trips/:id`, which logged the constant string "Trip details
    // updated" with no metadata. That absence is why migration 0041 cannot say
    // what currency a pre-#47 expense was paid in, and has to record NULL
    // instead. Log it now so the next person asking this question has an answer.
    metadata: {
      from: body.from,
      to: body.to,
      rate,
      expenseRates: Object.fromEntries(expenseRates),
    },
  })

  return { converted: true, rate }
})
