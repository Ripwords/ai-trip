/**
 * ISO 4217 currencies with exponent 0 — no minor unit at all.
 *
 * TWD (cents), IDR (sen) and HUF (fillér) used to be listed here and are not
 * zero-decimal: all three are exponent 2. Listing them made every amount in
 * those currencies 100x wrong, since a NT$1,234.56 dinner parsed to 1234 minor
 * units and rendered back as "1234".
 */
export const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"])

export function currencyDecimals(code: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.has(code.toUpperCase()) ? 0 : 2
}

/** Format a money amount as a DB-ready numeric string with the currency's conventional precision. */
export function formatCurrencyAmount(amount: number, code: string): string {
  return amount.toFixed(currencyDecimals(code))
}
