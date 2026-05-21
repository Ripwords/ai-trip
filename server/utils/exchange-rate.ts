// Cached FX rate fetcher. Wraps Frankfurter (free, no key). Rates are
// cached for 6 hours — exchange rates don't move enough to matter at the
// granularity we display estimated activity costs.

const _getExchangeRate = defineCachedFunction(
  async (_event: unknown, from: string, to: string): Promise<number | null> => {
    if (from === to) return 1
    try {
      const response = await $fetch<{ rate: number }>(
        `https://api.frankfurter.dev/v2/rate/${from}/${to}`,
      )
      if (!Number.isFinite(response.rate) || response.rate <= 0) return null
      return response.rate
    } catch {
      // Frankfurter doesn't support some currencies (e.g. TWD, VND). Treat
      // any failure as "unknown rate" — callers should fall back gracefully.
      return null
    }
  },
  {
    maxAge: 60 * 60 * 6,
    name: "exchangeRate",
    group: "fx",
    getKey: (_event: unknown, from: string, to: string) =>
      `${from.toUpperCase()}_${to.toUpperCase()}`,
  },
)

export function getExchangeRate(from: string, to: string): Promise<number | null> {
  return _getExchangeRate(null, from.toUpperCase(), to.toUpperCase())
}

/**
 * Convert `amount` from one currency to another. Returns null if the rate
 * is unavailable (Frankfurter doesn't cover the pair) so callers can fall
 * back to "no cost estimate" rather than storing a garbage number.
 */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
): Promise<number | null> {
  if (from.toUpperCase() === to.toUpperCase()) return amount
  const rate = await getExchangeRate(from, to)
  if (rate == null) return null
  return amount * rate
}
