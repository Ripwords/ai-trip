// Cached FX rate fetcher. Wraps Frankfurter (free, no key). Rates are
// cached for 6 hours — exchange rates don't move enough to matter at the
// granularity we display estimated activity costs.

/**
 * Below this, the provider's fixed 5-decimal output has lost too many
 * significant figures to be used as money.
 *
 * VND->USD comes back as `3.8e-05` — two significant figures. Applied to a
 * ₫26,209,000 hotel bill that is $995.94 against a true $1,000.00, a 0.4%
 * error baked permanently into `fx_rate` and `amount_in_trip_currency`. The
 * inverse pair (USD->VND = 26209) keeps all five, so fetch that instead and
 * invert it. Only zero-decimal, high-magnitude currencies reach this path.
 */
const MIN_DIRECT_RATE = 0.001

async function fetchRate(from: string, to: string): Promise<number | null> {
  const response = await $fetch<{ rate: number }>(
    `https://api.frankfurter.dev/v2/rate/${from}/${to}`,
  )
  if (!Number.isFinite(response.rate) || response.rate <= 0) return null
  return response.rate
}

const _getExchangeRate = defineCachedFunction(
  async (_event: unknown, from: string, to: string): Promise<number | null> => {
    if (from === to) return 1
    try {
      const direct = await fetchRate(from, to)
      if (direct == null) return null
      if (direct >= MIN_DIRECT_RATE) return direct

      // Recover the lost precision from the other direction. If the inverse
      // lookup fails for any reason, the direct rate is still better than no
      // rate at all — it is imprecise, not wrong.
      try {
        const inverse = await fetchRate(to, from)
        if (inverse != null && inverse > 0) return 1 / inverse
      } catch {
        // fall through to the direct rate
      }
      return direct
    } catch (e) {
      // Treat any failure (network error, unsupported currency pair) as
      // "unknown rate" — callers must fall back gracefully instead of
      // storing a garbage number.
      console.warn(`[fx] rate fetch failed for ${from}->${to}:`, e)
      return null
    }
  },
  {
    maxAge: 60 * 60 * 6,
    name: "exchangeRate",
    group: "fx",
    getKey: (_event: unknown, from: string, to: string) =>
      `${from.toUpperCase()}_${to.toUpperCase()}`,
    // Never cache failures — a transient FX error must not stick for 6h.
    validate: (entry) => entry.value != null,
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
