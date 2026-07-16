import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { getExchangeRate } from "../../../utils/exchange-rate"
import { convertTripMoney } from "../../../lib/convert-trip-currency"

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
  // upstream call doesn't hold a DB transaction open. getExchangeRate is
  // cached (6h) and validates the rate (finite, > 0).
  const rate = await getExchangeRate(body.from, body.to)
  if (rate == null) {
    throw createError({
      statusCode: 502,
      message: "Could not fetch exchange rate. Please try again.",
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

    await convertTripMoney(tx, id, rate, body.to)
  })

  return { converted: true, rate }
})
