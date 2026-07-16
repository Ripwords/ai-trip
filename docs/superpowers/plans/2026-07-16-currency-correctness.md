# Currency Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two reported currency failures — reservations skipped by trip-currency conversion, and AI cost estimates coming back at the wrong scale — while consolidating duplicated FX plumbing.

**Architecture:** All money stays in the trip's single `currencyCode`. Conversion moves into a testable lib (`convertTripMoney`) that now covers reservations. AI prompts get FX-anchored price examples computed from a live USD rate (`server/lib/currency-context.ts`), and a plausibility guard (`server/lib/cost-guard.ts`) validates every AI cost estimate at the two DB persistence points, falling back to Google price data or `null`.

**Tech Stack:** Nuxt (Nitro server routes), Drizzle ORM (PostgreSQL), Zod, AI SDK + Mastra (Gemini), Frankfurter FX API, `bun test` (node:test-style, preload shims in `server/test-setup.ts`).

**Spec:** `docs/superpowers/specs/2026-07-16-currency-correctness-design.md`

## Global Constraints

- TypeScript: never use `any`; `as unknown as X` only when strictly necessary (test fakes for injected drizzle handles are the accepted case).
- Conventional Commits (`fix:`, `feat:`, `refactor:`, `test:`, `chore:`).
- TDD: write the failing test first for every new module.
- Tests run with `bun test <path>`; the preload in `bunfig.toml` shims `defineCachedFunction`/`createError`/`$fetch` — server modules import cleanly.
- No DB schema changes in this plan; never write to the production DB.
- Before declaring done: `bun test` (all), `bun run check`, and `bun run build` must pass (`nuxt build` catches Vue template errors typecheck misses).
- Server files import `shared/` via **relative paths** (bun test can't resolve the `#shared` alias); app files use `#shared/utils/currency`.

---

### Task 1: Shared currency constants

The `ZERO_DECIMAL_CURRENCIES` set is copy-pasted in `app/composables/useCurrencyFormat.ts:4`, `server/lib/cost-from-place.ts:6`, and `server/lib/ai.ts:41`. Create one shared module and point the first two at it (`ai.ts`'s copy is deleted in Task 3).

**Files:**
- Create: `shared/utils/currency.ts`
- Create: `shared/utils/currency.test.ts`
- Modify: `app/composables/useCurrencyFormat.ts:1-4`
- Modify: `server/lib/cost-from-place.ts:1-11`

**Interfaces:**
- Produces: `ZERO_DECIMAL_CURRENCIES: Set<string>`, `currencyDecimals(code: string): 0 | 2`, `formatCurrencyAmount(amount: number, code: string): string` (DB-ready numeric string, e.g. `"1500"` for JPY, `"12.50"` for USD). Tasks 3 and 4 import these.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/utils/currency.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { ZERO_DECIMAL_CURRENCIES, currencyDecimals, formatCurrencyAmount } = await import(
  "./currency"
)

describe("currencyDecimals", () => {
  it("returns 0 for zero-decimal currencies regardless of case", () => {
    assert.equal(currencyDecimals("JPY"), 0)
    assert.equal(currencyDecimals("jpy"), 0)
    assert.equal(currencyDecimals("KRW"), 0)
  })

  it("returns 2 for decimal currencies", () => {
    assert.equal(currencyDecimals("USD"), 2)
    assert.equal(currencyDecimals("EUR"), 2)
  })
})

describe("formatCurrencyAmount", () => {
  it("formats zero-decimal currencies as whole units", () => {
    assert.equal(formatCurrencyAmount(1500.4, "JPY"), "1500")
  })

  it("formats decimal currencies with two decimals", () => {
    assert.equal(formatCurrencyAmount(12.5, "USD"), "12.50")
  })
})

describe("ZERO_DECIMAL_CURRENCIES", () => {
  it("contains the ISO 4217 zero-decimal set used across the app", () => {
    for (const code of ["JPY", "KRW", "VND", "IDR", "TWD", "CLP", "ISK", "HUF"]) {
      assert.ok(ZERO_DECIMAL_CURRENCIES.has(code), `missing ${code}`)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test shared/utils/currency.test.ts`
Expected: FAIL — `Cannot find module './currency'`

- [ ] **Step 3: Write the implementation**

```typescript
// shared/utils/currency.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test shared/utils/currency.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Point the two existing copies at the shared module**

In `app/composables/useCurrencyFormat.ts`, replace lines 3–4 (the comment + local `const ZERO_DECIMAL_CURRENCIES = new Set([...])`) with:

```typescript
import { ZERO_DECIMAL_CURRENCIES } from "#shared/utils/currency"
```

In `server/lib/cost-from-place.ts`, replace lines 4–11 (the comment, local set, and local `formatAmount`) with an import, and update the one call site:

```typescript
import { formatCurrencyAmount } from "../../shared/utils/currency"
```

At the end of `deriveCostFromPlace`, change `return formatAmount(converted, tripCurrency)` to `return formatCurrencyAmount(converted, tripCurrency)`.

- [ ] **Step 6: Verify nothing broke**

Run: `bun test && bun run build`
Expected: all tests PASS; nuxt build succeeds (proves `#shared` resolves in the app bundle)

- [ ] **Step 7: Commit**

```bash
git add shared/ app/composables/useCurrencyFormat.ts server/lib/cost-from-place.ts
git commit -m "refactor(currency): single shared zero-decimal currency module"
```

---

### Task 2: Convert reservations on currency change (testable conversion lib)

The endpoint's money-update SQL moves into `server/lib/convert-trip-currency.ts` with an injected transaction handle (repo pattern: deps injection, see `enrich.ts`). The new lib adds the missing `reservations.amount` conversion. The endpoint keeps its row-lock/409 concurrency check and switches its raw `$fetch` to the cached, validated `getExchangeRate`.

**Files:**
- Create: `server/lib/convert-trip-currency.ts`
- Create: `server/lib/convert-trip-currency.test.ts`
- Modify: `server/api/trips/[id]/convert-currency.post.ts`

**Interfaces:**
- Consumes: `getExchangeRate(from: string, to: string): Promise<number | null>` from `server/utils/exchange-rate.ts`.
- Produces: `convertTripMoney(tx: Tx, tripId: string, rate: number, toCurrency: string): Promise<void>` and `type Tx` (drizzle transaction handle).

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/convert-trip-currency.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { trips, activities, expenses, reservations } from "../db/schema"

const { convertTripMoney } = await import("./convert-trip-currency")
type Tx = import("./convert-trip-currency").Tx

interface RecordedUpdate {
  table: unknown
  set: Record<string, unknown>
}

function makeFakeTx(dayRows: { id: string }[]) {
  const updates: RecordedUpdate[] = []
  const fake = {
    select: () => ({ from: () => ({ where: async () => dayRows }) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, set: values })
        },
      }),
    }),
  }
  // Structural fake for the drizzle transaction handle — accepted case for the cast.
  return { tx: fake as unknown as Tx, updates }
}

describe("convertTripMoney", () => {
  it("converts reservations.amount alongside activities, expenses, and budget", async () => {
    const { tx, updates } = makeFakeTx([{ id: "day-1" }])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    const tables = updates.map((u) => u.table)
    assert.ok(tables.includes(reservations), "reservations must be converted")
    assert.ok(tables.includes(expenses), "expenses must be converted")
    assert.ok(tables.includes(trips), "trips must be updated")
    assert.equal(tables.filter((t) => t === activities).length, 2, "costEstimate and actualCost")

    const reservationUpdate = updates.find((u) => u.table === reservations)!
    assert.ok("amount" in reservationUpdate.set)
  })

  it("sets the new currency code on the trip", async () => {
    const { tx, updates } = makeFakeTx([])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    const tripUpdate = updates.find((u) => u.table === trips)!
    assert.equal(tripUpdate.set.currencyCode, "EUR")
  })

  it("skips activity updates when the trip has no itinerary days", async () => {
    const { tx, updates } = makeFakeTx([])
    await convertTripMoney(tx, "trip-1", 0.9, "EUR")

    assert.ok(!updates.some((u) => u.table === activities))
    assert.ok(updates.some((u) => u.table === reservations))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/convert-trip-currency.test.ts`
Expected: FAIL — `Cannot find module './convert-trip-currency'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/convert-trip-currency.ts
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db } from "../db"
import { trips, activities, expenses, reservations, itineraryDays } from "../db/schema"

/** Drizzle transaction handle, structurally (also satisfied by `db` itself). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Multiply every money column on a trip by `rate` and stamp the new currency.
 * Runs inside the caller's transaction so a mid-flight failure can't leave the
 * trip half-converted. Covers: activity costEstimate/actualCost, expenses,
 * reservations, and the trip budget.
 */
export async function convertTripMoney(
  tx: Tx,
  tripId: string,
  rate: number,
  toCurrency: string,
): Promise<void> {
  const dayRows = await tx
    .select({ id: itineraryDays.id })
    .from(itineraryDays)
    .where(eq(itineraryDays.tripId, tripId))
  const dayIds = dayRows.map((d) => d.id)

  if (dayIds.length > 0) {
    await tx
      .update(activities)
      .set({
        costEstimate: sql`ROUND(${activities.costEstimate}::numeric * ${rate}::numeric, 2)`,
      })
      .where(and(inArray(activities.itineraryDayId, dayIds), isNotNull(activities.costEstimate)))

    await tx
      .update(activities)
      .set({
        actualCost: sql`ROUND(${activities.actualCost}::numeric * ${rate}::numeric, 2)`,
      })
      .where(and(inArray(activities.itineraryDayId, dayIds), isNotNull(activities.actualCost)))
  }

  await tx
    .update(expenses)
    .set({ amount: sql`ROUND(${expenses.amount}::numeric * ${rate}::numeric, 2)` })
    .where(eq(expenses.tripId, tripId))

  await tx
    .update(reservations)
    .set({ amount: sql`ROUND(${reservations.amount}::numeric * ${rate}::numeric, 2)` })
    .where(and(eq(reservations.tripId, tripId), isNotNull(reservations.amount)))

  await tx
    .update(trips)
    .set({
      budget: sql`CASE WHEN ${trips.budget} IS NULL THEN NULL ELSE ROUND(${trips.budget}::numeric * ${rate}::numeric, 2) END`,
      currencyCode: toCurrency,
    })
    .where(eq(trips.id, tripId))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/convert-trip-currency.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Rewire the endpoint**

Replace the full contents of `server/api/trips/[id]/convert-currency.post.ts` with:

```typescript
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { getExchangeRate } from "../../../utils/exchange-rate"
import { convertTripMoney } from "../../../lib/convert-trip-currency"

const bodySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  if (body.from === body.to) {
    return { converted: false, rate: 1 }
  }

  // Fetch exchange rate BEFORE opening the transaction so a slow/failing
  // upstream call doesn't hold a DB transaction open. getExchangeRate is
  // cached (6h) and validates the rate (finite, > 0).
  const rate = await getExchangeRate(body.from, body.to)
  if (rate == null) {
    throw createError({
      statusCode: 502,
      message: "Could not fetch exchange rate. Please try again.",
    })
  }

  // All mutations run in a single transaction so a mid-flight failure can't
  // leave the trip in a half-converted state.
  await db.transaction(async (tx) => {
    // Lock the trip row and verify the client's `from` matches what's actually
    // stored. Protects against concurrent conversions (collaborator A converts
    // USD→EUR while B's stale client still thinks the trip is USD and submits
    // USD→JPY — without this check, B would corrupt every cost on the trip).
    const [current] = await tx
      .select({ currencyCode: trips.currencyCode })
      .from(trips)
      .where(eq(trips.id, id))
      .for("update")
    if (!current) {
      throw createError({ statusCode: 404, message: "Trip not found" })
    }
    if (current.currencyCode !== body.from) {
      throw createError({
        statusCode: 409,
        message: `Trip currency is already ${current.currencyCode}, not ${body.from}. Refresh and try again.`,
      })
    }

    await convertTripMoney(tx, id, rate, body.to)
  })

  return { converted: true, rate }
})
```

- [ ] **Step 6: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean

- [ ] **Step 7: Commit**

```bash
git add server/lib/convert-trip-currency.ts server/lib/convert-trip-currency.test.ts "server/api/trips/[id]/convert-currency.post.ts"
git commit -m "fix(currency): convert reservation amounts on trip currency change"
```

---

### Task 3: FX-anchored currency prompt context

Replace the static price hints in `buildCurrencyCtx` with anchors computed from a live USD→trip-currency rate, in a new dedicated module (keeps it unit-testable without importing the Mastra-heavy `ai.ts`). Thread the rate through `processUserRequest` (day AI) and `createDiscussTools` (discuss agent).

**Files:**
- Create: `server/lib/currency-context.ts`
- Create: `server/lib/currency-context.test.ts`
- Modify: `server/lib/ai.ts` (delete lines 40–50; `handleAdd`/`handleFillGaps` params; `processUserRequest`)
- Modify: `server/lib/ai-tools.ts:180` (DiscussToolsContext), `:213`, `:241-246`
- Modify: `server/api/trips/[id]/discuss.post.ts:191-200`
- Modify: `server/lib/ai-tools.test.ts` (ctx fixtures at lines ~40, ~51 gain `usdRate: null`)

**Interfaces:**
- Consumes: `ZERO_DECIMAL_CURRENCIES` (Task 1), `getExchangeRate` (existing).
- Produces: `buildCurrencyCtx(currencyCode: string | undefined, usdRate: number | null): string` and `costAnchorHint(currencyCode: string, usdRate: number | null): string`. `DiscussToolsContext` gains required `usdRate: number | null`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/currency-context.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { buildCurrencyCtx, costAnchorHint } = await import("./currency-context")

describe("buildCurrencyCtx", () => {
  it("computes local anchors from the USD rate for zero-decimal currencies", () => {
    const ctx = buildCurrencyCtx("JPY", 150)
    assert.ok(ctx.includes("1 USD ≈ 150 JPY"))
    assert.ok(ctx.includes("coffee ~750"))
    assert.ok(ctx.includes("casual lunch ~1,500–3,000"))
    assert.ok(ctx.includes("whole units"))
    assert.ok(ctx.includes("MUST be in JPY"))
  })

  it("computes anchors for decimal currencies and shows a 2dp rate under 10", () => {
    const ctx = buildCurrencyCtx("EUR", 0.9)
    assert.ok(ctx.includes("1 USD ≈ 0.90 EUR"))
    assert.ok(ctx.includes("MUST be in EUR"))
    assert.ok(!ctx.includes("whole units"))
  })

  it("falls back to static hints when the rate is unavailable", () => {
    const ctx = buildCurrencyCtx("JPY", null)
    assert.ok(ctx.includes("~1500, not 15"))
    assert.ok(ctx.includes("MUST be in JPY"))
  })

  it("rejects non-finite or non-positive rates", () => {
    assert.ok(buildCurrencyCtx("JPY", 0).includes("~1500, not 15"))
    assert.ok(buildCurrencyCtx("JPY", Number.NaN).includes("~1500, not 15"))
  })

  it("defaults to USD when no code is given", () => {
    assert.ok(buildCurrencyCtx(undefined, null).includes("MUST be in USD"))
  })
})

describe("costAnchorHint", () => {
  it("embeds the rate and a lunch anchor when the rate is known", () => {
    const hint = costAnchorHint("VND", 26000)
    assert.ok(hint.includes("1 USD ≈ 26,000 VND"))
    assert.ok(hint.includes("390,000 VND"))
  })

  it("falls back to the static hint when the rate is unknown", () => {
    const hint = costAnchorHint("JPY", null)
    assert.ok(hint.includes("Cost per visit in JPY"))
    assert.ok(hint.includes("zero-decimal"))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/currency-context.test.ts`
Expected: FAIL — `Cannot find module './currency-context'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/currency-context.ts
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
export function buildCurrencyCtx(
  currencyCode: string | undefined,
  usdRate: number | null,
): string {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/currency-context.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Rewire `server/lib/ai.ts`**

1. Add imports at the top:

```typescript
import { buildCurrencyCtx } from "./currency-context"
import { getExchangeRate } from "../utils/exchange-rate"
```

2. Delete lines 40–50 (the local `ZERO_DECIMAL_CURRENCIES` const and local `buildCurrencyCtx` function — the comment above them included).

3. In `handleAdd`'s params type, below `currencyCode: string`, add:

```typescript
    usdRate: number | null
```

and change its `system:` line to:

```typescript
    system: `You are a local travel expert. ${SCHEDULE_RULES} ALL places must be in ${params.destination}.${buildCurrencyCtx(params.currencyCode, params.usdRate)}`,
```

4. Same two edits in `handleFillGaps` (params gain `usdRate: number | null`; its `system:` line passes `params.usdRate`).

5. In `processUserRequest`, after the `safeDestination` block (`params = { ...params, destination: safeDestination }`), add:

```typescript
  // Live USD→trip-currency rate for prompt anchors. Null degrades to static
  // hints inside buildCurrencyCtx — never blocks generation.
  const usdRate = await getExchangeRate("USD", params.currencyCode)
```

6. Pass `usdRate` in all three `handleAdd`/`handleFillGaps` call sites (`add` case, `modify` case step 2, `fill_gaps` case):

```typescript
          currencyCode: params.currencyCode,
          usdRate,
```

- [ ] **Step 6: Rewire `server/lib/ai-tools.ts`**

1. Add import:

```typescript
import { costAnchorHint } from "./currency-context"
```

2. Change the empty interface at line 180 to:

```typescript
interface DiscussToolsContext extends TripToolsContext {
  /** Live USD→trip-currency rate for cost anchors; null degrades to static hints. */
  usdRate: number | null
}
```

3. In `proposeAddActivities`, replace the `costEstimate` field's `.describe(...)` (lines ~241-246) with:

```typescript
          costEstimate: z.number().min(0).describe(costAnchorHint(ctx.currencyCode, ctx.usdRate)),
```

- [ ] **Step 7: Rewire `server/api/trips/[id]/discuss.post.ts`**

1. Add import:

```typescript
import { getExchangeRate } from "../../../utils/exchange-rate"
```

2. Just before the `createDiscussTools` call (~line 191), fetch the rate and pass it in the ctx:

```typescript
  const usdRate = await getExchangeRate("USD", trip.currencyCode || "USD")

  const tools = createDiscussTools(
    {
      tripId: id,
      activeDayId: dayId ?? "",
      days,
      transportMode,
      currencyCode: trip.currencyCode || "USD",
      usdRate,
    },
    proposalCollector,
  )
```

- [ ] **Step 8: Update ai-tools test fixtures**

In `server/lib/ai-tools.test.ts`, the two ctx factory objects (lines ~40 and ~51, the ones containing `currencyCode: "USD"`) each gain:

```typescript
    usdRate: null,
```

- [ ] **Step 9: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean

- [ ] **Step 10: Commit**

```bash
git add server/lib/currency-context.ts server/lib/currency-context.test.ts server/lib/ai.ts server/lib/ai-tools.ts server/lib/ai-tools.test.ts "server/api/trips/[id]/discuss.post.ts"
git commit -m "fix(ai): FX-anchored currency context so cost estimates use the right scale"
```

---

### Task 4: Cost plausibility guard at persistence

Validate every AI cost estimate before it reaches the DB: convert to USD-equivalent, check per-type bounds, fall back to Google price data (`deriveCostFromPlace`), else store `null`. Wire at both insert points.

**Files:**
- Create: `server/lib/cost-guard.ts`
- Create: `server/lib/cost-guard.test.ts`
- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts:276-296`
- Modify: `server/lib/proposals.ts:166-177` (ApplyContext) and `:255-283` (add-activities insert)
- Modify: `server/api/trips/[id]/proposals/apply.post.ts:33-43`
- Modify: `server/lib/proposals.test.ts` (any `applyProposal` ctx literal gains `currencyCode: "USD"`)

**Interfaces:**
- Consumes: `getExchangeRate` (existing), `deriveCostFromPlace(placeId: string, tripCurrency: string): Promise<string | null>` (existing), `formatCurrencyAmount` (Task 1).
- Produces: `guardCostEstimate(input: { costEstimate: number; type: string; placeId: string | null; currencyCode: string }, deps?: CostGuardDeps): Promise<string | null>`. `ApplyContext` gains required `currencyCode: string`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/cost-guard.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { guardCostEstimate } = await import("./cost-guard")

function deps(overrides: {
  rate?: number | null
  derived?: string | null
  derivedCalls?: string[]
}) {
  return {
    getRate: async () => overrides.rate ?? null,
    deriveCost: async (placeId: string) => {
      overrides.derivedCalls?.push(placeId)
      return overrides.derived ?? null
    },
  }
}

describe("guardCostEstimate", () => {
  it("keeps a plausible estimate, formatted for the currency", async () => {
    // 1500 JPY at rate 150 → $10 USD-equivalent, inside restaurant bounds.
    const result = await guardCostEstimate(
      { costEstimate: 1500, type: "restaurant", placeId: null, currencyCode: "JPY" },
      deps({ rate: 150 }),
    )
    assert.equal(result, "1500")
  })

  it("keeps a free attraction (0 is within attraction bounds)", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 0, type: "park", placeId: null, currencyCode: "JPY" },
      deps({ rate: 150 }),
    )
    assert.equal(result, "0")
  })

  it("rejects a wrong-scale estimate and falls back to Google price data", async () => {
    // 15 JPY for a restaurant ≈ $0.10 — below the $1 floor. Google knows better.
    const derivedCalls: string[] = []
    const result = await guardCostEstimate(
      { costEstimate: 15, type: "restaurant", placeId: "place-1", currencyCode: "JPY" },
      deps({ rate: 150, derived: "1800", derivedCalls }),
    )
    assert.equal(result, "1800")
    assert.deepEqual(derivedCalls, ["place-1"])
  })

  it("stores null when implausible and Google has no price data", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 15, type: "restaurant", placeId: "place-1", currencyCode: "JPY" },
      deps({ rate: 150, derived: null }),
    )
    assert.equal(result, null)
  })

  it("stores null when implausible and there is no placeId", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 999999, type: "cafe", placeId: null, currencyCode: "USD" },
      deps({ rate: 1 }),
    )
    assert.equal(result, null)
  })

  it("accepts the AI value untouched when the FX rate is unavailable", async () => {
    // Never null everything because Frankfurter is down.
    const result = await guardCostEstimate(
      { costEstimate: 15, type: "restaurant", placeId: "place-1", currencyCode: "JPY" },
      deps({ rate: null }),
    )
    assert.equal(result, "15")
  })

  it("formats decimal currencies with two decimals", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 12.5, type: "cafe", placeId: null, currencyCode: "USD" },
      deps({ rate: 1 }),
    )
    assert.equal(result, "12.50")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/cost-guard.test.ts`
Expected: FAIL — `Cannot find module './cost-guard'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/cost-guard.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/cost-guard.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire into the day-AI endpoint**

In `server/api/trips/[id]/days/[dayId]/ai.post.ts`, add the import:

```typescript
import { guardCostEstimate } from "../../../../../lib/cost-guard"
```

Then, inside the `if (enrichedActivities.length > 0) {` block (~line 266), before the `db.insert(activities).values(` call, add:

```typescript
          const guardedCosts = await Promise.all(
            enrichedActivities.map((a) =>
              guardCostEstimate({
                costEstimate: a.costEstimate,
                type: a.type,
                placeId: a.placeId,
                currencyCode: trip.currencyCode || "USD",
              }),
            ),
          )
```

and change the insert's cost line (`costEstimate: activity.costEstimate.toString(),`) to:

```typescript
              costEstimate: guardedCosts[index] ?? null,
```

- [ ] **Step 6: Wire into the proposal apply engine**

In `server/lib/proposals.ts`:

1. Add import:

```typescript
import { guardCostEstimate } from "./cost-guard"
```

2. In `ApplyContext` (line 166), below `transportMode: TransportMode`, add:

```typescript
  /** Trip currency for cost-estimate validation on add-activities. */
  currencyCode: string
```

3. In the `case "add-activities":` block, inside `if (located.length > 0) {`, before the `db.insert(activities)` call, add:

```typescript
          const guardedCosts = await Promise.all(
            located.map((a) =>
              guardCostEstimate({
                costEstimate: a.costEstimate,
                type: a.type,
                placeId: a.placeId,
                currencyCode: ctx.currencyCode,
              }),
            ),
          )
```

and change `costEstimate: a.costEstimate.toString(),` to:

```typescript
                costEstimate: guardedCosts[i] ?? null,
```

In `server/api/trips/[id]/proposals/apply.post.ts`, add to the `applyProposal(proposal, { ... })` ctx literal:

```typescript
      currencyCode: trip.currencyCode || "USD",
```

- [ ] **Step 7: Update proposals test fixtures**

In `server/lib/proposals.test.ts`, every object literal passed as the second argument to `applyProposal(...)` gains:

```typescript
        currencyCode: "USD",
```

(In tests the `$fetch` stub makes `getExchangeRate` return null, so the guard accepts AI values unchanged — existing assertions keep passing.)

- [ ] **Step 8: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean

- [ ] **Step 9: Commit**

```bash
git add server/lib/cost-guard.ts server/lib/cost-guard.test.ts server/lib/proposals.ts server/lib/proposals.test.ts "server/api/trips/[id]/days/[dayId]/ai.post.ts" "server/api/trips/[id]/proposals/apply.post.ts"
git commit -m "fix(ai): reject implausible AI cost estimates before they reach the DB"
```

---

### Task 5: Consolidate the exchange-rate endpoint

`server/api/exchange-rate.get.ts` has its own uncached-validation copy of the FX fetcher with a colliding cache name. Replace with the shared util; clean up the outdated Frankfurter-coverage comment.

**Files:**
- Modify: `server/api/exchange-rate.get.ts` (full rewrite, shrinks to ~15 lines)
- Modify: `server/utils/exchange-rate.ts:14-16` (comment only)

**Interfaces:**
- Consumes: `getExchangeRate` (existing). Response shape `{ rate: number }` is unchanged for the frontend.

Note: the spec lists an endpoint test ("returns rate from the shared util; 502 on null"), but this repo has no `defineEventHandler` test harness and all existing tests target libs/utils. The rate logic being tested already lives in the shared util; building an endpoint harness for a 15-line handler is out of scope (YAGNI). The 502 path is covered by the runtime spot-check in Task 6.

- [ ] **Step 1: Rewrite the endpoint**

Replace the full contents of `server/api/exchange-rate.get.ts` with:

```typescript
import { z } from "zod"
import { getExchangeRate } from "../utils/exchange-rate"

const querySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const { from, to } = await getValidatedQuery(event, querySchema.parse)

  // getExchangeRate handles from === to (rate 1), caching (6h), and validation.
  const rate = await getExchangeRate(from, to)
  if (rate == null) {
    throw createError({
      statusCode: 502,
      message: "Could not fetch exchange rate. Please try again.",
    })
  }
  return { rate }
})
```

- [ ] **Step 2: Fix the outdated comment**

In `server/utils/exchange-rate.ts`, replace the comment at lines 14–16:

```typescript
      // Treat any failure (network error, unsupported currency pair) as
      // "unknown rate" — callers must fall back gracefully instead of
      // storing a garbage number.
```

(The old text claimed Frankfurter lacks TWD/VND — verified 2026-07-16 that `api.frankfurter.dev/v2` covers them.)

- [ ] **Step 3: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean

- [ ] **Step 4: Commit**

```bash
git add server/api/exchange-rate.get.ts server/utils/exchange-rate.ts
git commit -m "refactor(currency): exchange-rate endpoint reuses the shared cached FX util"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS, zero failures (existing suites + 4 new test files)

- [ ] **Step 2: Lint and format**

Run: `bun run check`
Expected: format clean, no new lint warnings beyond the repo's pre-existing ones

- [ ] **Step 3: Production build**

Run: `bun run build`
Expected: `nuxt build` succeeds (catches Vue template compile errors typecheck misses — required before done)

- [ ] **Step 4: Runtime spot-check (if a local dev environment is available)**

With the local docker DB (`bun run docker:dev`) and seeded data (`bun run db:seed-test`):
1. Open a trip → Settings → change currency (e.g. USD→EUR) → confirm activities, expenses, budget, **and reservations** all change together.
2. Change it back and confirm values round-trip to roughly the originals.
3. Ask the day AI to add an activity on a JPY-currency trip → confirm the stored `costEstimate` is a plausible whole-yen amount.

- [ ] **Step 5: Commit any stragglers and report**

```bash
git status
```

Expected: clean tree; every task committed separately.
