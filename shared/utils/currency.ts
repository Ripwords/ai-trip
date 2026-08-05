/**
 * ISO 4217 currencies with exponent 0 — no minor unit at all.
 *
 * TWD (cents), IDR (sen) and HUF (fillér) used to be listed here and are not
 * zero-decimal: all three are exponent 2. Listing them made every amount in
 * those currencies 100x wrong, since a NT$1,234.56 dinner parsed to 1234 minor
 * units and rendered back as "1234".
 */
export const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"])

/**
 * ISO 4217 currencies with exponent 3 (mils). These are *deliberately absent*
 * from `SUPPORTED_CURRENCIES` below.
 *
 * `currencyDecimals` returns `0 | 2` and `toMinorUnits`/`fromMinorUnits` scale
 * by 1 or 100, so a three-decimal currency would silently truncate — a 1.234 KWD
 * coffee would store as 1.23 KWD and lose real money. Rejecting them at
 * validation is honest; the alternative is a `0 | 2 | 3` refactor of every money
 * helper for currencies this app has never offered in a picker. If one is ever
 * needed, widen `currencyDecimals` and the two scale factors *first*, then add
 * it to `SUPPORTED_CURRENCIES` — never the other way round.
 */
export const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "KWD", "TND", "JOD", "OMR", "LYD"])

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

/**
 * Every currency code the API will accept, for a trip or for a single expense.
 *
 * `currencyCode` used to be `z.string().length(3).toUpperCase()`, which accepts
 * `"1a3"` and stores it as `"1A3"`. That string reaches `Intl.NumberFormat` in
 * the expense list, which throws `RangeError` on an invalid code — inside a
 * render path, so the whole expenses tab white-screened for every member of the
 * trip, with no UI left to delete the offending row.
 *
 * Two constraints decide the membership of this set:
 *
 * 1. **It must be priceable.** `server/utils/exchange-rate.ts` has to be able to
 *    fetch a rate to the trip's currency, or every foreign expense on the trip
 *    is a 502 for a condition that never succeeds. Every code below was
 *    confirmed against the rate endpoint in both directions. (The provider's
 *    published currency *list* omits VND and TWD, but its rate endpoint prices
 *    both — the list is the ECB reference set, the rate endpoint is wider.)
 * 2. **It must have 0 or 2 decimals.** See `THREE_DECIMAL_CURRENCIES` above.
 *
 * The expense set is deliberately wider than `TRIP_CURRENCIES`: you can pay for
 * one thing in CHF on a JPY trip without CHF being a sensible trip currency.
 */
export const SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set([
  // The trip-picker set.
  ...TRIP_CURRENCIES.map((c) => c.code),
  // Additional currencies accepted on an individual expense.
  "BRL",
  "CHF",
  "CZK",
  "DKK",
  "HKD",
  "HUF",
  "ILS",
  "ISK",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "RON",
  "SEK",
  "TRY",
  "ZAR",
])

/**
 * Whether `code` may be *written* to the database. Read paths must stay
 * tolerant: rows predating this check can hold anything, and refusing to render
 * them would reproduce the white-screen this check exists to prevent.
 */
export function isSupportedCurrency(code: string | null | undefined): boolean {
  return code != null && SUPPORTED_CURRENCIES.has(code.toUpperCase())
}
