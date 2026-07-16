/** ISO 4217 currencies that don't use minor units (cents/subdivisions). */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
  "IDR",
  "TWD",
  "CLP",
  "ISK",
  "HUF",
])

export function currencyDecimals(code: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.has(code.toUpperCase()) ? 0 : 2
}

/** Format a money amount as a DB-ready numeric string with the currency's conventional precision. */
export function formatCurrencyAmount(amount: number, code: string): string {
  return amount.toFixed(currencyDecimals(code))
}
