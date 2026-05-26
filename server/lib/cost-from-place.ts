import { getPlacePricing } from "./google-maps"
import { convertCurrency } from "../utils/exchange-rate"

// Zero-decimal currencies — Intl reports 0 fraction digits and the AI is
// told to use whole units. Keep DB representation consistent.
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "IDR", "TWD", "CLP", "ISK", "HUF"])

function formatAmount(amount: number, currencyCode: string): string {
  const digits = ZERO_DECIMAL_CURRENCIES.has(currencyCode.toUpperCase()) ? 0 : 2
  return amount.toFixed(digits)
}

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
  return formatAmount(converted, tripCurrency)
}
