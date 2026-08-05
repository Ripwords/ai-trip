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

/**
 * The currencies offered in pickers. Lived inline in TripSettingsSheet until
 * expenses gained a currency of their own (#47) and needed the same list — two
 * copies would have drifted.
 */
export const TRIP_CURRENCIES = [
  { code: "USD", label: "USD ($)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "JPY", label: "JPY (¥)" },
  { code: "KRW", label: "KRW (₩)" },
  { code: "THB", label: "THB (฿)" },
  { code: "SGD", label: "SGD (S$)" },
  { code: "AUD", label: "AUD (A$)" },
  { code: "CAD", label: "CAD (C$)" },
  { code: "MYR", label: "MYR (RM)" },
  { code: "IDR", label: "IDR (Rp)" },
  { code: "TWD", label: "TWD (NT$)" },
  { code: "VND", label: "VND (₫)" },
  { code: "PHP", label: "PHP (₱)" },
  { code: "INR", label: "INR (₹)" },
  { code: "CNY", label: "CNY (¥)" },
] as const
