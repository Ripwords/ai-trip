import { getExchangeRate } from "../utils/exchange-rate"
import { deriveCostFromPlace } from "./cost-from-place"
import { formatCurrencyAmount } from "../../shared/utils/currency"

/**
 * Plausibility bounds per activity type, in USD-equivalent. Tunable. A value
 * outside its type's band is treated as an AI scale error (e.g. "15" for a
 * ramen lunch on a JPY trip), not a real price.
 */
const USD_BOUNDS: Record<string, { min: number; max: number }> = {
  restaurant: { min: 1, max: 500 },
  cafe: { min: 1, max: 500 },
  bar: { min: 1, max: 500 },
  attraction: { min: 0, max: 1000 },
  museum: { min: 0, max: 1000 },
  park: { min: 0, max: 1000 },
  entertainment: { min: 0, max: 1000 },
  spa: { min: 0, max: 1000 },
  hotel: { min: 10, max: 5000 },
  transport: { min: 0, max: 2000 },
  shopping: { min: 0, max: 2000 },
}
const DEFAULT_BOUNDS = { min: 0, max: 2000 }

export interface CostGuardDeps {
  getRate: (from: string, to: string) => Promise<number | null>
  deriveCost: (placeId: string, tripCurrency: string) => Promise<string | null>
}

const defaultDeps: CostGuardDeps = {
  getRate: getExchangeRate,
  deriveCost: deriveCostFromPlace,
}

/**
 * Validate an AI-provided cost estimate (expressed in the trip currency).
 * Returns a DB-ready numeric string, or null when the value is implausible
 * and no trusted source (Google price data) can replace it. When the FX rate
 * is unavailable the guard is skipped and the AI value is accepted.
 */
export async function guardCostEstimate(
  input: { costEstimate: number; type: string; placeId: string | null; currencyCode: string },
  deps: CostGuardDeps = defaultDeps,
): Promise<string | null> {
  const code = input.currencyCode.toUpperCase()

  const usdRate = await deps.getRate("USD", code)
  if (usdRate == null || !Number.isFinite(usdRate) || usdRate <= 0) {
    return formatCurrencyAmount(input.costEstimate, code)
  }

  const usdEquivalent = input.costEstimate / usdRate
  const bounds = USD_BOUNDS[input.type] ?? DEFAULT_BOUNDS
  if (usdEquivalent >= bounds.min && usdEquivalent <= bounds.max) {
    return formatCurrencyAmount(input.costEstimate, code)
  }

  console.warn(
    `[cost-guard] Implausible ${input.type} estimate rejected: ${input.costEstimate} ${code} (~$${usdEquivalent.toFixed(2)} USD)`,
  )

  if (input.placeId) {
    try {
      const derived = await deps.deriveCost(input.placeId, code)
      if (derived != null) return derived
    } catch {
      // Google lookup failed — fall through to null.
    }
  }
  return null
}
