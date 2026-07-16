# Currency Correctness — Design

**Date:** 2026-07-16
**Status:** Approved
**Phase:** 1 of 4 (later phases: AI quick wins → trip-level generation with SSE progress → streaming discuss chat; each gets its own spec)

## Problem

Two user-reported failures:

1. **Amounts wrong after switching currency.** The trip-wide conversion endpoint
   (`server/api/trips/[id]/convert-currency.post.ts`) converts
   `activities.costEstimate`, `activities.actualCost`, `expenses.amount`, and
   `trips.budget` — but skips `reservations.amount`. `ReservationTracker.vue`
   formats reservation amounts with the trip's currency symbol, so after a
   conversion those numbers are silently wrong (old-currency values shown with
   the new-currency symbol).

2. **AI cost estimates in the wrong scale/currency.** `gemini-3.1-flash-lite`
   is instructed (in `buildCurrencyCtx`, `server/lib/ai.ts`) to output
   `costEstimate` in the trip currency using whole units for zero-decimal
   currencies, but it does not reliably follow this — e.g. returning `15` for a
   ramen lunch on a JPY trip. Prompting alone has already proven insufficient.

**Decision constraint (user):** estimates must remain expressed in the trip's
currency. Do NOT switch the AI to estimating in USD with server-side
conversion of the estimate itself.

## Design

### 1. Convert reservations on currency change

Add `reservations.amount` to the existing transaction in
`convert-currency.post.ts`, using the same
`ROUND(amount::numeric * rate::numeric, 2)` pattern as expenses, with an
`IS NOT NULL` guard (the column is nullable). No schema change.

### 2. Accurate AI estimates in the trip currency

Two layers; the AI keeps outputting trip-currency amounts.

**2a. FX-anchored prompting.** `buildCurrencyCtx(currencyCode)` becomes
`buildCurrencyCtx(currencyCode, usdRate | null)`. Callers fetch the
USD→trip-currency rate via the existing cached `getExchangeRate`
(`server/utils/exchange-rate.ts`, 6h TTL) before building prompts. With a rate
available, the context injects concrete local anchors computed from USD price
bands, rounded per zero-decimal rules — e.g. for JPY at rate 150:

> "1 USD ≈ 150 JPY. Realistic anchors: coffee ~750, casual lunch ~1,500–3,000,
> sit-down dinner ~4,500–9,000, museum entry ~2,000. Adjust to local price
> levels."

USD anchor bands (coffee 5, casual lunch 10–20, dinner 30–60, museum 13, etc.)
live next to the builder as a constant. When the rate is unavailable, fall
back to the current static hint text (today's behavior).

This applies everywhere `buildCurrencyCtx` is used (`handleAdd`,
`handleFillGaps`) and to the discuss propose-tool descriptions in
`server/lib/ai-tools.ts` (same anchor text, since `createDiscussTools` has
`ctx.currencyCode`).

**2b. Plausibility guard at persistence.** A new helper (e.g.
`server/lib/cost-guard.ts`) validates an AI-provided estimate before it is
stored:

- Convert the estimate to its USD equivalent using the cached rate.
- Check against per-activity-type USD bounds (initial values below, kept as a
  tunable constant covering all 11 activity types):
  - restaurant / cafe / bar: $1–$500
  - attraction / museum / park / entertainment / spa: $0–$1,000
  - hotel: $10–$5,000
  - transport / shopping: $0–$2,000
- In range → keep the AI value.
- Out of range → try Google's `priceRange` via the existing
  `deriveCostFromPlace(placeId, tripCurrency)`; if Google has no price data,
  store `null` (established convention — never store a garbage number). Log
  each guard rejection.
- If the FX rate is unavailable, the guard is skipped and the AI value is
  accepted (never null everything because Frankfurter is down).

Wire the guard at the two persistence points:
- `server/api/trips/[id]/days/[dayId]/ai.post.ts` (~line 292, day-AI inserts)
- `server/lib/proposals.ts` (~line 279, `applyProposal` inserts — covers both
  discuss-agent and itinerary-review proposals)

### 3. FX plumbing cleanup

- `server/api/exchange-rate.get.ts` currently has its own duplicate
  `defineCachedFunction` fetcher with no rate validation and a colliding cache
  name (`exchangeRate` with a different key format than the util's). Replace
  it with a thin handler calling `getExchangeRate`; return 502 when the rate
  is null.
- `convert-currency.post.ts` fetches Frankfurter raw with `$fetch`; switch to
  `getExchangeRate` (gains 6h caching + validation). Keep the existing
  behavior: 502 with no partial writes when the rate is unavailable.
- Move `ZERO_DECIMAL_CURRENCIES` (copy-pasted in
  `app/composables/useCurrencyFormat.ts`, `server/lib/cost-from-place.ts`,
  `server/lib/ai.ts`) to the Nuxt `shared/` directory as a single constant
  imported by client and server.
- Delete outdated comments claiming Frankfurter lacks TWD/VND/IDR support
  (verified 2026-07-16: `api.frankfurter.dev/v2` covers them and other minor
  currencies).

### 4. Testing & error handling

TDD (tests first, following existing server test patterns, e.g.
`server/lib/*.test.ts` with mocked deps):

- **Anchor builder:** zero-decimal rounding (JPY anchors are whole numbers),
  decimal currencies keep 2dp-friendly values, missing-rate fallback returns
  the static hint, rate=1 (USD trip) produces sane text.
- **Plausibility guard:** per-type boundary values (in-range kept,
  out-of-range rejected), Google fallback used when available, null when not,
  guard skipped when rate is null.
- **Conversion endpoint:** reservations rows are converted alongside
  activities/expenses/budget; NULL amounts untouched; concurrent-conversion
  409 behavior unchanged.
- **Exchange-rate endpoint:** returns rate from the shared util; 502 on null.

Error paths: FX failure during a currency switch keeps the current
502 + transaction-rollback behavior; FX failure during generation degrades to
static hints and no guard.

## Out of scope (deliberately)

- Per-expense/multi-currency entry (user did not select this symptom).
- Model upgrades, research caching, retry/validation of non-cost fields
  (Phase 2), trip-level generation (Phase 3), streaming chat (Phase 4).
