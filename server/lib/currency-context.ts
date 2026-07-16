import { ZERO_DECIMAL_CURRENCIES } from "../../shared/utils/currency"

const fmt = (n: number): string => new Intl.NumberFormat("en-US").format(n)

/** USD price bands used to compute local-currency anchor examples. Tunable. */
const USD_ANCHORS = {
  coffee: 5,
  casualLunchLow: 10,
  casualLunchHigh: 20,
  dinnerLow: 30,
  dinnerHigh: 60,
  museumEntry: 13,
} as const

function isValidRate(rate: number | null): rate is number {
  return rate != null && Number.isFinite(rate) && rate > 0
}

function formatRate(usdRate: number): string {
  return usdRate >= 10 ? fmt(Math.round(usdRate)) : usdRate.toFixed(2)
}

function localAmount(usd: number, usdRate: number): string {
  return fmt(Math.max(1, Math.round(usd * usdRate)))
}

/**
 * Prompt block instructing the model to express costEstimate in the trip
 * currency. With a live USD rate, injects concrete local price anchors so the
 * model never does FX mental math; without one, falls back to static hints.
 */
export function buildCurrencyCtx(currencyCode: string | undefined, usdRate: number | null): string {
  const code = (currencyCode || "USD").toUpperCase()
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code)

  if (!isValidRate(usdRate)) {
    const scaleHint = isZeroDecimal
      ? `Use realistic whole-unit amounts (e.g. a ramen lunch in JPY is ~1500, not 15).`
      : `Use realistic amounts in ${code} (a coffee is ~5, a casual lunch ~20, a sit-down dinner ~40, a museum entry ~25 — adjust to local price levels).`
    return `\nCURRENCY: All costEstimate values MUST be in ${code}. Do NOT convert to USD. ${scaleHint} Reflect local pricing for the destination.`
  }

  const local = (usd: number) => localAmount(usd, usdRate)
  const anchors = `1 USD ≈ ${formatRate(usdRate)} ${code}. Realistic anchors in ${code}: coffee ~${local(USD_ANCHORS.coffee)}, casual lunch ~${local(USD_ANCHORS.casualLunchLow)}–${local(USD_ANCHORS.casualLunchHigh)}, sit-down dinner ~${local(USD_ANCHORS.dinnerLow)}–${local(USD_ANCHORS.dinnerHigh)}, museum entry ~${local(USD_ANCHORS.museumEntry)}.`
  const zeroHint = isZeroDecimal ? ` ${code} uses whole units — never output decimal amounts.` : ""
  return `\nCURRENCY: All costEstimate values MUST be in ${code}. Do NOT convert to USD. ${anchors} Adjust to the destination's actual price level.${zeroHint}`
}

/** One-line variant for tool field descriptions (discuss propose* tools). */
export function costAnchorHint(currencyCode: string, usdRate: number | null): string {
  const code = currencyCode.toUpperCase()
  if (!isValidRate(usdRate)) {
    return `Cost per visit in ${code}. Use whole units for zero-decimal currencies (JPY/KRW/VND/IDR/TWD).`
  }
  const lunch = localAmount(15, usdRate)
  return `Cost per visit in ${code} (1 USD ≈ ${formatRate(usdRate)} ${code}; a casual lunch is roughly ${lunch} ${code}). Use whole units for zero-decimal currencies (JPY/KRW/VND/IDR/TWD).`
}
