import { z } from "zod"
import { getExchangeRate } from "../utils/exchange-rate"

const querySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { from, to } = await getValidatedQuery(event, querySchema.parse)

  // getExchangeRate handles from === to (rate 1), caching (6h), and validation.
  const rate = await getExchangeRate(from, to)
  if (rate == null) {
    throw createError({
      statusCode: 502,
      message: "Could not fetch exchange rate. Please try again.",
    })
  }
  return { rate }
})
