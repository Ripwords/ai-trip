import { getPlacePricing } from "./google-maps"
import { convertCurrency } from "../utils/exchange-rate"
import { formatCurrencyAmount } from "../../shared/utils/currency"

/**
 * Try to derive a default cost estimate for a manually-added activity by
 * reading Google's `priceRange` (the "Around $10–20" range shown in Google
 * Maps) and converting to the trip currency. Returns null if Google has
 * no price data for the place or the FX rate is unavailable — callers
 * should leave costEstimate null in that case rather than guessing.
 */
export async function deriveCostFromPlace(
  placeId: string,
  tripCurrency: string,
): Promise<string | null> {
  const pricing = await getPlacePricing(placeId)
  if (!pricing?.priceRange) return null
  const midpoint = (pricing.priceRange.startAmount + pricing.priceRange.endAmount) / 2
  if (!Number.isFinite(midpoint) || midpoint <= 0) return null

  const converted = await convertCurrency(midpoint, pricing.priceRange.currencyCode, tripCurrency)
  if (converted == null) return null
  return formatCurrencyAmount(converted, tripCurrency)
}
