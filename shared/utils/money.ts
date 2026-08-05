/**
 * Integer money arithmetic.
 *
 * Every money column in this app is a Postgres `numeric` read back as a
 * decimal *string*. The rest of the codebase turned those into JS numbers with
 * `parseFloat` and summed them, which drifts: `0.1 + 0.2 !== 0.3`, and
 * `parseFloat("0.29") * 100` is `28.999999999999996`. Once splits and
 * settlement transfers have to reconcile to the cent, that drift becomes a
 * visible "someone owes 0.01" bug.
 *
 * So all arithmetic here happens in **minor units** (cents, or whole units for
 * zero-decimal currencies like JPY) as safe integers, and the decimal string
 * is produced only at the boundary.
 */

import { currencyDecimals } from "./currency"

/** `123.45` -> `12345`. Returns null when the text is not a money value. */
export function toMinorUnits(amount: string, currencyCode: string): number | null {
  const text = amount.trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null

  const [, sign, whole, fraction = ""] = match
  const decimals = currencyDecimals(currencyCode)
  // Pad or truncate to the currency's precision. Truncating rather than
  // rounding is deliberate: a stored value with more decimals than the
  // currency has is already malformed, and rounding it up would invent money.
  const scaled = (fraction + "0".repeat(decimals)).slice(0, decimals)
  const value = Number(`${whole}${scaled}`)
  if (!Number.isSafeInteger(value)) return null
  return sign === "-" ? -value : value
}

/**
 * The number of minor units in one major unit — `10 ** decimals`.
 *
 * Derived rather than hardcoded to `100`: `currencyDecimals` is the single
 * place that knows a currency's exponent, and a hardcoded `/ 100` here would
 * silently truncate the moment it learns about a third decimal. See
 * `THREE_DECIMAL_CURRENCIES` in ./currency for why none are accepted today.
 */
export function minorUnitFactor(currencyCode: string): number {
  return 10 ** currencyDecimals(currencyCode)
}

/** `12345` -> `"123.45"`, DB-ready at the currency's precision. */
export function fromMinorUnits(minor: number, currencyCode: string): string {
  const decimals = currencyDecimals(currencyCode)
  if (decimals === 0) return String(Math.round(minor))

  const factor = minorUnitFactor(currencyCode)
  const sign = minor < 0 ? "-" : ""
  const abs = Math.abs(Math.round(minor))
  const whole = Math.floor(abs / factor)
  const rest = abs % factor
  return `${sign}${whole}.${String(rest).padStart(decimals, "0")}`
}

/** For values that are already JS numbers (form inputs, API rates). */
export function minorUnitsFromNumber(amount: number, currencyCode: string): number {
  return Math.round(amount * minorUnitFactor(currencyCode))
}

/** Convenience so callers don't hand-roll a reduce over integers. */
export function sumMinorUnits(values: readonly number[]): number {
  let total = 0
  for (const v of values) total += v
  return total
}

/**
 * Convert `minor` (in `fromCurrency`) to `toCurrency` at `rate`, rounded to the
 * target currency's precision. The rate itself is a float — it comes from an FX
 * API — but it is applied exactly once, to an integer, and rounded immediately,
 * so no drift accumulates across a list.
 */
export function multiplyMinorUnits(
  minor: number,
  fromCurrency: string,
  rate: number,
  toCurrency: string,
): number {
  return Math.round((minor / minorUnitFactor(fromCurrency)) * rate * minorUnitFactor(toCurrency))
}
