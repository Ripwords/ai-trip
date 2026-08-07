# Thinking-Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-request "thinking mode" toggle that enables DeepSeek reasoning, widens the trip context the model sees, and raises the discuss step budget — billed at a flat 3× multiplier — while unconditionally fixing the accommodation-coordinate and return-flight blind spots it exposed.

**Architecture:** A `thinking: boolean` flows from the client body through both AI endpoints. It selects provider options (`ai-config.ts`), gates extra prompt context (`ai.ts`), multiplies the credit charge (`ai-credit-cost.ts`), and raises the discuss step ceiling behind a wall-clock guard. Reasoning deltas — currently dropped by `mapChunk` — become a new `thinking` SSE event so the slower mode shows progress instead of dead air. Geographic defects (dropped lat/lng, unanchored return flight) are fixed for both modes.

**Tech Stack:** Nuxt 4 (Nitro server routes), Vercel AI SDK v5 + `@ai-sdk/deepseek@3.0.12`, Mastra agents, Drizzle ORM, zod, `node:test` + `node:assert/strict` run via `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-07-thinking-mode-toggle-design.md`

## Global Constraints

- **Never use `any`.** Never use `as unknown as X` unless strictly necessary. (Global CLAUDE.md.)
- **TDD:** write the failing test, watch it fail, then implement. Every task follows this cycle.
- **Conventional Commits** (`feat:`, `fix:`, `test:`, `refactor:`).
- **Run tests with `bun test <path>`** — there is no `package.json` test script.
- **`bunx nuxi typecheck` has a pre-existing error baseline of exactly 46 errors** (measured on this branch, count with `bunx nuxi typecheck 2>&1 | grep -cE "error TS"` — do NOT pipe through `head`/`tail` before counting). Do not chase pre-existing errors; only ensure you add none. Task 6b deliberately clears one, taking the baseline to 45 from that point on.
- **`bun test server/utils/ server/lib/ app/composables/` baseline: 858 pass, 0 fail, 56 files.**
- **Run `bunx nuxi build` before declaring the branch done** — typecheck misses Vue template compile errors.
- Thinking multiplier is **3**. Thinking discuss step ceiling is **40**. Wall-clock guard threshold is **200_000 ms**.
- `chargeExtraAiCredits` signature is `(userId, extra, month)` — **extra before month**. Do not transpose.
- Both credit primitives are **non-idempotent**. Every settle path must run through exactly one guard.
- The full-itinerary generation loop (`app/composables/useGenerateFullItinerary.ts`) **must never send `thinking: true`** — a 10-day trip would cost 30 of the user's 100 monthly credits in one click. It simply omits the field, which defaults to `false`.

---

## File Structure

| File                                            | Responsibility                           | Change     |
| ----------------------------------------------- | ---------------------------------------- | ---------- |
| `server/utils/ai-credit-cost.ts`                | Pure pricing math + step constants       | Modify     |
| `server/utils/ai-credit-cost.test.ts`           | Pricing unit tests                       | Modify     |
| `server/utils/ai-limits.ts`                     | Credit ledger primitives                 | Modify     |
| `server/lib/ai-config.ts`                       | Model registry + provider options        | Modify     |
| `server/lib/ai-config.test.ts`                  | Provider-option unit tests               | Modify     |
| `server/lib/ai.ts`                              | Prompt construction + handlers           | Modify     |
| `server/lib/ai.test.ts`                         | Prompt-context unit tests                | Modify     |
| `server/api/trips/[id]/days/[dayId]/ai.post.ts` | Day-generation endpoint                  | Modify     |
| `server/lib/discuss-stream.ts`                  | Chunk → SSE mapping                      | Modify     |
| `server/lib/discuss-stream.test.ts`             | Mapper unit tests                        | Modify     |
| `shared/utils/discuss-sse.ts`                   | SSE wire contract                        | Modify     |
| `server/api/trips/[id]/discuss.post.ts`         | Discuss streaming endpoint               | Modify     |
| `app/composables/useThinkingMode.ts`            | sessionStorage-backed toggle state       | **Create** |
| `app/composables/useThinkingMode.test.ts`       | Toggle unit tests                        | **Create** |
| `app/components/AiDock.vue`                     | Composer toggle + thinking disclosure    | Modify     |
| `app/pages/trips/[id].vue`                      | Sends `thinking`, handles `thinking` SSE | Modify     |

---

### Task 1: Credit primitives — amount-aware refund, ceiling-aware pricing

**Files:**

- Modify: `server/utils/ai-credit-cost.ts`
- Modify: `server/utils/ai-limits.ts:128-133`
- Test: `server/utils/ai-credit-cost.test.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces:
  - `THINKING_CREDIT_MULTIPLIER: number` (= 3)
  - `MAX_DISCUSS_STEPS_THINKING: number` (= 40)
  - `creditsForSteps(steps: number, ceiling?: number): number`
  - `discussStepCeiling(thinking: boolean): number`
  - `refundAiCredit(userId: string, month: string, amount?: number): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `server/utils/ai-credit-cost.test.ts`. Also update the existing import line at the top of that file to pull in the new exports:

```ts
import {
  creditsForSteps,
  discussStepCeiling,
  MAX_DISCUSS_STEPS,
  MAX_DISCUSS_STEPS_THINKING,
  STEPS_PER_CREDIT,
  THINKING_CREDIT_MULTIPLIER,
} from "./ai-credit-cost"
```

```ts
describe("creditsForSteps with an explicit ceiling", () => {
  it("defaults to the normal ceiling when none is given", () => {
    // Every existing caller passes one argument. Their behaviour must not move.
    assert.equal(creditsForSteps(MAX_DISCUSS_STEPS + 5), creditsForSteps(MAX_DISCUSS_STEPS))
  })

  it("bills a thinking turn against the thinking ceiling, not the normal one", () => {
    // The bug this parameter exists to prevent: creditsForSteps used to clamp at
    // MAX_DISCUSS_STEPS internally, so a 40-step thinking turn silently billed as 30.
    const at40 = creditsForSteps(40, MAX_DISCUSS_STEPS_THINKING)
    assert.equal(at40, 5)
    assert.ok(at40 > creditsForSteps(40), "the thinking ceiling must bill more than the normal one")
  })

  it("still clamps at whatever ceiling it was given", () => {
    assert.equal(
      creditsForSteps(MAX_DISCUSS_STEPS_THINKING + 10, MAX_DISCUSS_STEPS_THINKING),
      creditsForSteps(MAX_DISCUSS_STEPS_THINKING, MAX_DISCUSS_STEPS_THINKING),
    )
  })

  it("never returns zero or negative for garbage input, ceiling or not", () => {
    assert.equal(creditsForSteps(-1, MAX_DISCUSS_STEPS_THINKING), 1)
    assert.equal(creditsForSteps(Number.NaN, MAX_DISCUSS_STEPS_THINKING), 1)
  })
})

describe("discussStepCeiling", () => {
  it("returns the normal ceiling in normal mode", () => {
    assert.equal(discussStepCeiling(false), MAX_DISCUSS_STEPS)
  })

  it("returns the raised ceiling in thinking mode", () => {
    assert.equal(discussStepCeiling(true), MAX_DISCUSS_STEPS_THINKING)
  })
})

describe("THINKING_CREDIT_MULTIPLIER", () => {
  it("is a whole number greater than one", () => {
    // Fractional multipliers would let a turn bill a fraction of a credit, which
    // the integer promptCount column cannot represent.
    assert.ok(Number.isInteger(THINKING_CREDIT_MULTIPLIER))
    assert.ok(THINKING_CREDIT_MULTIPLIER > 1)
  })

  it("keeps the worst-case thinking turn inside a sane share of the monthly allowance", () => {
    // MONTHLY_LIMIT is 100. A single turn must never be able to eat a fifth of it.
    const worstCase =
      creditsForSteps(MAX_DISCUSS_STEPS_THINKING, MAX_DISCUSS_STEPS_THINKING) *
      THINKING_CREDIT_MULTIPLIER
    assert.ok(worstCase <= 20, `worst-case thinking turn costs ${worstCase} credits`)
  })
})

describe("MAX_DISCUSS_STEPS_THINKING", () => {
  it("is higher than the normal ceiling", () => {
    assert.ok(MAX_DISCUSS_STEPS_THINKING > MAX_DISCUSS_STEPS)
  })

  it("is only safe because a wall-clock guard exists", () => {
    // At ~8x thinking latency this ceiling CAN exceed the 300s function limit on
    // step count alone. discuss.post.ts must strip tools on elapsed time too.
    // If that guard is ever removed, drop this ceiling back to MAX_DISCUSS_STEPS.
    assert.ok(MAX_DISCUSS_STEPS_THINKING <= 40)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/utils/ai-credit-cost.test.ts`
Expected: FAIL — `discussStepCeiling`, `MAX_DISCUSS_STEPS_THINKING`, and `THINKING_CREDIT_MULTIPLIER` are not exported.

- [ ] **Step 3: Implement the pricing changes**

In `server/utils/ai-credit-cost.ts`, replace the `creditsForSteps` function and append the new exports:

```ts
/**
 * Hard ceiling on tool-call steps for a THINKING turn.
 *
 * Higher than MAX_DISCUSS_STEPS because thinking mode buys the agent room to
 * research more before proposing — that extra room is part of what the 3x
 * charge pays for.
 *
 * This ceiling is ONLY safe in combination with the elapsed-time guard in
 * discuss.post.ts's prepareStep. Thinking mode runs ~8x slower per step, so 40
 * steps can exceed Vercel's 300s function limit on step count alone — and a
 * timeout kills the process before the catch-block refund runs, billing the
 * user 3x for nothing. Time is the real budget; this is the secondary cap.
 * If the time guard is ever removed, drop this back to MAX_DISCUSS_STEPS.
 */
export const MAX_DISCUSS_STEPS_THINKING = 40

/** Flat multiplier applied to a thinking turn's whole credit cost. */
export const THINKING_CREDIT_MULTIPLIER = 3

/** The step ceiling that applies to a turn, given its mode. */
export function discussStepCeiling(thinking: boolean): number {
  return thinking ? MAX_DISCUSS_STEPS_THINKING : MAX_DISCUSS_STEPS
}

/**
 * Credits owed for a turn that used `steps` tool-call steps.
 *
 * Bracketed rather than linear so ordinary conversation stays at 1 credit and
 * only genuine research binges cost more.
 *
 * `ceiling` must be the ceiling the turn actually ran under. It used to be
 * hard-coded to MAX_DISCUSS_STEPS, which silently under-billed a 40-step
 * thinking turn as though it had stopped at 30. Defaulted so every existing
 * single-argument caller is unchanged.
 */
export function creditsForSteps(steps: number, ceiling: number = MAX_DISCUSS_STEPS): number {
  if (!Number.isFinite(steps) || steps <= 0) return 1
  const capped = Math.min(steps, ceiling)
  return Math.max(1, Math.ceil(capped / STEPS_PER_CREDIT))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/utils/ai-credit-cost.test.ts`
Expected: PASS — including all pre-existing tests, unchanged.

- [ ] **Step 5: Make the refund amount-aware**

In `server/utils/ai-limits.ts`, replace `refundAiCredit` (currently lines 115-133) with:

```ts
/**
 * Refund AI credits. Use after a planning step fails and no work was committed.
 * Does NOT go below zero.
 *
 * `amount` defaults to 1. A thinking-mode turn charges
 * THINKING_CREDIT_MULTIPLIER credits up front, so its failure paths MUST refund
 * the same number — the default-1 version pocketed 2 of every failed 3-credit
 * generation.
 *
 * NOT idempotent: the SQL is `GREATEST(count - amount, 0)`, so calling this
 * twice for a single consume decrements twice and mints the user free credits.
 * Each request must refund at most once — where a handler has several failure
 * paths, route them all through one guard (see discuss.post.ts's
 * `settleCredits` and ai.post.ts's `refundOnce`).
 *
 * `month` is the value `tryConsumeAiCredit` returned for this turn. Recomputing
 * "now" here would match zero rows across a month boundary and silently leave the
 * user charged (issue #17).
 */
export async function refundAiCredit(
  userId: string,
  month: string,
  amount: number = 1,
): Promise<void> {
  const n = Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1
  await db
    .update(aiUsage)
    .set({ promptCount: sql`GREATEST(${aiUsage.promptCount} - ${n}, 0)`, updatedAt: new Date() })
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.month, month)))
}
```

- [ ] **Step 6: Verify nothing else broke**

Run: `bun test server/utils/` and `bunx nuxi typecheck 2>&1 | tail -5`
Expected: pricing tests PASS; typecheck error count unchanged from baseline (both existing `refundAiCredit(userId, month)` call sites still compile — `amount` is optional).

- [ ] **Step 7: Commit**

```bash
git add server/utils/ai-credit-cost.ts server/utils/ai-credit-cost.test.ts server/utils/ai-limits.ts
git commit -m "feat(credits): ceiling-aware step pricing and amount-aware refunds"
```

---

### Task 2: Model layer — provider options and availability

**Files:**

- Modify: `server/lib/ai-config.ts`
- Test: `server/lib/ai-config.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces:
  - `aiProviderOptions(thinking: boolean): { deepseek: Record<string, unknown> }`
  - `thinkingAvailable(): boolean`
  - `AI_PROVIDER_OPTIONS` stays exported, unchanged in value.

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/ai-config.test.ts` (add the new names to its existing import from `./ai-config`):

```ts
describe("aiProviderOptions", () => {
  it("disables thinking in normal mode, matching the long-standing default", () => {
    // DeepSeek V4 defaults to thinking ON. Everything outside the opt-in path
    // depends on it being explicitly off.
    assert.deepEqual(aiProviderOptions(false), {
      deepseek: { thinking: { type: "disabled" } },
    })
  })

  it("enables thinking with an explicit reasoning effort in thinking mode", () => {
    assert.deepEqual(aiProviderOptions(true), {
      deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    })
  })

  it("namespaces everything under `deepseek` so Gemini call sites ignore it", () => {
    // getModel falls back to Gemini without DEEPSEEK_API_KEY. A stray top-level
    // key would reach that provider and could throw on an unknown option.
    assert.deepEqual(Object.keys(aiProviderOptions(true)), ["deepseek"])
    assert.deepEqual(Object.keys(aiProviderOptions(false)), ["deepseek"])
  })

  it("agrees with the AI_PROVIDER_OPTIONS constant in normal mode", () => {
    assert.deepEqual(aiProviderOptions(false), AI_PROVIDER_OPTIONS)
  })
})

describe("thinkingAvailable", () => {
  it("is false without a DeepSeek key, because the Gemini fallback cannot think", () => {
    // getModel silently returns a Gemini model when the key is missing, and
    // Gemini ignores deepseek-namespaced options entirely. Charging 3x for a
    // request that provably never reasoned is the bug this guards.
    const prev = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      assert.equal(thinkingAvailable(), false)
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev
    }
  })

  it("is true when a DeepSeek key is configured", () => {
    const prev = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = "test-key"
    try {
      assert.equal(thinkingAvailable(), true)
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = prev
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/ai-config.test.ts`
Expected: FAIL — `aiProviderOptions` and `thinkingAvailable` are not exported.

- [ ] **Step 3: Implement**

In `server/lib/ai-config.ts`, append after the existing `AI_PROVIDER_OPTIONS` constant:

```ts
/**
 * Provider options for one call, given whether the traveler opted into thinking.
 *
 * Normal mode reproduces AI_PROVIDER_OPTIONS exactly: DeepSeek V4 defaults to a
 * hidden reasoning phase that is ~8x slower, so it stays explicitly off unless
 * asked for. Thinking mode turns it on and pins the effort rather than letting
 * the provider pick, so cost and latency are predictable enough to bill against.
 *
 * Everything stays namespaced under `deepseek` — Gemini call sites (and the
 * no-key Gemini fallback in getModel) ignore the whole object.
 */
export function aiProviderOptions(thinking: boolean) {
  return thinking
    ? { deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" } }
    : { deepseek: { thinking: { type: "disabled" } } }
}

/**
 * Whether thinking mode can actually do anything right now.
 *
 * False without DEEPSEEK_API_KEY: getModel falls back to Gemini, which ignores
 * deepseek-namespaced provider options entirely. Endpoints MUST consult this
 * and downgrade both the mode AND the price — otherwise the fallback charges
 * the 3x multiplier for a request that never reasoned at all.
 */
export function thinkingAvailable(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/lib/ai-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-config.ts server/lib/ai-config.test.ts
git commit -m "feat(ai): add thinking-mode provider options and availability guard"
```

---

### Task 3: Unconditional geography fixes (free tier)

These are defects, not gated features. They apply in **both** modes.

**Files:**

- Modify: `server/lib/ai.ts:298-318` (`buildFlightsCtx`), `:460`, `:577`
- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts:252-254`
- Test: `server/lib/ai.test.ts`

**Interfaces:**

- Consumes: nothing from Tasks 1-2.
- Produces:
  - `StartLocation` widens to `{ name: string; address: string | null; lat?: number | null; lng?: number | null }`
  - `formatAnchor(a: { name: string; address: string | null; lat?: number | null; lng?: number | null }): string`
  - `buildFlightsCtx(flights?: FlightPromptInput[], planningDate?: string): string`

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/ai.test.ts` (add `buildFlightsCtx` and `formatAnchor` to its imports from `./ai`):

```ts
describe("formatAnchor", () => {
  it("includes the address and coordinates when known", () => {
    // The model was geolocating hotels from their NAME alone — ai.post.ts fetched
    // lat/lng then dropped them one line later, and the prompt rendered only the
    // name. Coordinates are the whole point of the anchor.
    const out = formatAnchor({
      name: "Hotel Gracery Shinjuku",
      address: "1-19-1 Kabukicho, Shinjuku City, Tokyo",
      lat: 35.6955,
      lng: 139.7006,
    })
    assert.ok(out.includes("Hotel Gracery Shinjuku"))
    assert.ok(out.includes("1-19-1 Kabukicho"))
    assert.ok(out.includes("35.6955"))
    assert.ok(out.includes("139.7006"))
  })

  it("degrades cleanly when coordinates are missing", () => {
    const out = formatAnchor({ name: "Some Guesthouse", address: null, lat: null, lng: null })
    assert.equal(out, "Some Guesthouse")
  })

  it("renders the address alone when only coordinates are missing", () => {
    const out = formatAnchor({
      name: "Some Guesthouse",
      address: "12 Main St",
      lat: null,
      lng: null,
    })
    assert.ok(out.includes("12 Main St"))
    assert.ok(!out.includes("["), "no empty coordinate bracket")
  })
})

describe("buildFlightsCtx", () => {
  const flights = [
    {
      departureAirport: "SIN",
      arrivalAirport: "NRT",
      departureTimeUtc: null,
      arrivalTimeUtc: null,
      departureTimeLocal: "2026-08-10 08:00+08:00",
      arrivalTimeLocal: "2026-08-10 16:20+09:00",
    },
    {
      departureAirport: "NRT",
      arrivalAirport: "SIN",
      departureTimeUtc: null,
      arrivalTimeUtc: null,
      departureTimeLocal: "2026-08-17 10:30+09:00",
      arrivalTimeLocal: "2026-08-17 17:05+08:00",
    },
  ]

  it("returns an empty string when there are no flights", () => {
    assert.equal(buildFlightsCtx(), "")
    assert.equal(buildFlightsCtx([]), "")
  })

  it("lists every flight, so the return leg is always visible", () => {
    const out = buildFlightsCtx(flights)
    assert.ok(out.includes("SIN → NRT"))
    assert.ok(out.includes("NRT → SIN"))
  })

  it("marks which flight falls on the day being planned", () => {
    // Without this the model had to date-match the list itself against the day
    // in scope, and silently mis-attributed flights on multi-flight trips.
    const out = buildFlightsCtx(flights, "2026-08-17")
    const lines = out.split("\n").filter((l) => l.startsWith("- "))
    const tagged = lines.filter((l) => l.includes("THIS DAY"))
    assert.equal(tagged.length, 1)
    assert.ok(tagged[0]!.includes("NRT → SIN"), "the departure leg is the one on 2026-08-17")
  })

  it("tags nothing when no flight falls on the planning date", () => {
    const out = buildFlightsCtx(flights, "2026-08-13")
    assert.ok(!out.includes("THIS DAY"))
  })

  it("omits the tag entirely when no planning date is supplied", () => {
    assert.ok(!buildFlightsCtx(flights).includes("THIS DAY"))
  })

  it("tells the model to bias a departure day toward the airport", () => {
    // Times alone never biased the last day's geography — the traveler could be
    // routed to the far side of the region on their departure morning.
    const out = buildFlightsCtx(flights, "2026-08-17")
    assert.ok(/departure airport/i.test(out))
  })

  it("keeps the existing hard timing rules", () => {
    const out = buildFlightsCtx(flights, "2026-08-10")
    assert.ok(out.includes("90 minutes"), "arrival buffer rule")
    assert.ok(out.includes("3 hours"), "departure buffer rule")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/ai.test.ts`
Expected: FAIL — `formatAnchor` is not exported; `buildFlightsCtx` takes one argument and emits no `THIS DAY` tag.

- [ ] **Step 3: Widen `StartLocation` and add `formatAnchor`**

In `server/lib/ai.ts`, replace the `StartLocation` interface at lines 138-141:

```ts
interface StartLocation {
  name: string
  address: string | null
  /**
   * Optional because two of the four call sites (optimize's endLocation, the
   * accommodation handler) genuinely have no coordinates to give. Where they ARE
   * available they must be passed: a name alone forces the model to geolocate
   * the venue from memory, which is exactly the defect formatAnchor exists to fix.
   */
  lat?: number | null
  lng?: number | null
}

/**
 * Render a location anchor for a prompt at the highest precision available.
 *
 * `Hotel X (12 Main St) [35.6955,139.7006]` — the coordinates are what let the
 * model reason about distance instead of recalling where it thinks the hotel is.
 * Degrades to `Hotel X` when nothing else is known, so a sparse row never
 * produces a dangling `()` or `[]` in the prompt.
 */
export function formatAnchor(a: {
  name: string
  address: string | null
  lat?: number | null
  lng?: number | null
}): string {
  const addr = a.address ? ` (${a.address})` : ""
  const coords = a.lat != null && a.lng != null ? ` [${a.lat},${a.lng}]` : ""
  return `${a.name}${addr}${coords}`
}
```

- [ ] **Step 4: Rewrite `buildFlightsCtx` with day tagging**

Replace `buildFlightsCtx` at `server/lib/ai.ts:298-318`:

```ts
export function buildFlightsCtx(flights?: FlightPromptInput[], planningDate?: string): string {
  if (!flights?.length) return ""
  const leg = (local: string | null, utc: string | null, verb: string) => {
    if (local) return `${verb} ${local} (local time)`
    if (utc) return `${verb} ${utc} (UTC — convert to the destination's local time)`
    return `${verb.replace(/s$/, "")} time unknown`
  }
  // A flight belongs to the day being planned if either end lands on that date.
  // Both fields are ISO-prefixed strings ("2026-08-17 10:30+09:00" or a UTC
  // ISO timestamp), so a prefix compare is enough and avoids a timezone library.
  const onPlanningDate = (f: FlightPromptInput): boolean => {
    if (!planningDate) return false
    return [f.departureTimeLocal, f.arrivalTimeLocal, f.departureTimeUtc, f.arrivalTimeUtc].some(
      (t) => typeof t === "string" && t.startsWith(planningDate),
    )
  }
  const lines = flights.map((f) => {
    const tag = onPlanningDate(f) ? " — THIS DAY" : ""
    return `- ${f.departureAirport ?? "?"} → ${f.arrivalAirport ?? "?"}: ${leg(
      f.departureTimeLocal,
      f.departureTimeUtc,
      "departs",
    )}, ${leg(f.arrivalTimeLocal, f.arrivalTimeUtc, "arrives")}${tag}`
  })
  return `\nTRAVELER'S FLIGHTS:\n${lines.join("\n")}
FLIGHT RULES (hard):
- If a flight ARRIVES on the day being planned, the day starts only after landing plus ~90 minutes for immigration, luggage, and transfer. Schedule NOTHING before that.
- If a flight DEPARTS on the day being planned, every activity must end at least 3 hours before departure.
- On a departure day, also bias the day's GEOGRAPHY toward the departure airport: prefer stops on the corridor between the accommodation and the airport, and never place the last stop further from the airport than the accommodation is. Timing rules alone still allow a final morning on the wrong side of the region.
- When flights leave only part of the day free (evening-only arrival, morning-only departure), plan just that window — do NOT fill the blocked hours, even if meals or blueprint slots fall inside them.`
}
```

**The scoping rule that bullet needs — do not skip this.** The
"only a flagged leg constrains this day" instruction may be emitted ONLY when
`planningDate` was supplied. When it is absent nothing is ever tagged, so that
sentence tells the model to ignore _every_ flight's timing and silently
suppresses the ~90-minute and 3-hour buffers. Two callers pass no date:
`handleReschedule` and `discuss-context.ts:155` (the live chat agent). With no
`planningDate` the output must keep the arrival/departure buffer rules
unqualified, exactly as before this task. Cover it with a test asserting that
the date-less output still carries both buffer rules and carries no instruction
to disregard flight timings.

- [ ] **Step 5: Use `formatAnchor` in the add and fill prompts**

In `server/lib/ai.ts`, in `handleAdd`, change the `accommodation` param type and the prompt line. The param at ~line 413 becomes:

```ts
    accommodation?: { name: string; address: string | null; lat?: number | null; lng?: number | null }
```

and the prompt line at ~460 becomes:

```ts
${params.accommodation ? `Staying at (where they sleep TONIGHT — the day must end here): ${formatAnchor(params.accommodation)}` : ""}
${params.startLocation ? `Start the day from: ${formatAnchor(params.startLocation)}` : ""}
```

In `handleFillGaps`, apply the same param widening at ~line 527, and change the prompt lines at ~577:

```ts
${params.accommodation ? `Accommodation (where they sleep TONIGHT — the day must end here): ${formatAnchor(params.accommodation)}` : ""}
${params.startLocation ? `Start point: ${formatAnchor(params.startLocation)}` : ""}
```

In `handleOptimize`, replace the two anchor lines at ~713-714:

```ts
${params.startLocation ? `START FROM: ${formatAnchor(params.startLocation)}` : ""}
${params.endLocation ? `END AT (accommodation — must be the last stop): ${formatAnchor(params.endLocation)}` : ""}
```

- [ ] **Step 6: Thread the planning date into every `buildFlightsCtx` call**

In `server/lib/ai.ts`, every call site inside a handler that knows the day's date passes it as the second argument: `buildFlightsCtx(params.flights, params.date)`. Apply to `handleAdd` (~462), `handleFillGaps` (~577), `handleOptimize` (~712), and `handleReschedule`. Leave the `discuss-context.ts` call site (which has no single planning date) as `buildFlightsCtx(flights)`.

- [ ] **Step 7: Stop dropping coordinates in the endpoint**

In `server/api/trips/[id]/days/[dayId]/ai.post.ts`, replace lines 252-254:

```ts
        startLocation: startLocation
          ? {
              name: startLocation.name,
              address: startLocation.address,
              // Fetched at :168-175 and, until now, discarded right here. Without
              // them the model geolocated last night's hotel from its name alone.
              lat: startLocation.lat,
              lng: startLocation.lng,
            }
          : undefined,
```

The `accommodation` object at :244-251 already carries `lat`/`lng` — no change needed there; it now reaches the prompt via `formatAnchor`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test server/lib/ai.test.ts`
Expected: PASS

- [ ] **Step 9: Verify no regressions**

Run: `bun test server/lib/` and `bunx nuxi typecheck 2>&1 | tail -5`
Expected: no new failures; typecheck baseline unchanged.

- [ ] **Step 10: Commit**

```bash
git add server/lib/ai.ts server/lib/ai.test.ts "server/api/trips/[id]/days/[dayId]/ai.post.ts"
git commit -m "fix(ai): give add/fill prompts real coordinates and anchor the departure day to the airport"
```

---

### Task 4: Gated context — next-stay lookahead

**Files:**

- Modify: `server/lib/ai.ts` (`handleAdd`, `handleFillGaps`, `processUserRequest`)
- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts`
- Test: `server/lib/ai.test.ts`

**Interfaces:**

- Consumes: `formatAnchor` (Task 3).
- Produces:
  - `buildNextStayCtx(next?: { name: string; address: string | null; lat?: number | null; lng?: number | null } | null, tonight?: { name: string } | null): string`
  - `processUserRequest` gains `thinking?: boolean` and `nextLocation?: StartLocation`.

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/ai.test.ts` (add `buildNextStayCtx` to the imports):

```ts
describe("buildNextStayCtx", () => {
  const next = {
    name: "Ryokan Kurashiki",
    address: "4-1 Honmachi, Kurashiki",
    lat: 34.5951,
    lng: 133.7715,
  }

  it("returns an empty string when there is no later stay", () => {
    assert.equal(buildNextStayCtx(null, { name: "Hotel Gracery Shinjuku" }), "")
    assert.equal(buildNextStayCtx(undefined, { name: "Hotel Gracery Shinjuku" }), "")
  })

  it("returns an empty string when the traveler does not move", () => {
    // "You relocate to Hotel X" when they are already at Hotel X is noise that
    // invites the model to invent a transfer that isn't happening.
    assert.equal(
      buildNextStayCtx(
        { ...next, name: "Hotel Gracery Shinjuku" },
        {
          name: "Hotel Gracery Shinjuku",
        },
      ),
      "",
    )
  })

  it("ignores case and surrounding whitespace when comparing stays", () => {
    assert.equal(
      buildNextStayCtx(
        { ...next, name: " hotel gracery SHINJUKU " },
        {
          name: "Hotel Gracery Shinjuku",
        },
      ),
      "",
    )
  })

  it("names the next base with full precision when the traveler relocates", () => {
    const out = buildNextStayCtx(next, { name: "Hotel Gracery Shinjuku" })
    assert.ok(out.includes("Ryokan Kurashiki"))
    assert.ok(out.includes("34.5951"))
  })

  it("tells the model to shorten tomorrow's transfer and not strand the traveler", () => {
    const out = buildNextStayCtx(next, { name: "Hotel Gracery Shinjuku" })
    assert.ok(/transfer/i.test(out))
    assert.ok(/strand|far from/i.test(out))
  })

  it("still emits guidance when tonight's stay is unknown", () => {
    // A day with no accommodation of its own still benefits from knowing where
    // the traveler ends up next.
    const out = buildNextStayCtx(next, null)
    assert.ok(out.includes("Ryokan Kurashiki"))
  })
})

describe("buildTripShapeCtx", () => {
  const days = [
    { dayNumber: 1, date: "2026-08-10", accommodationName: "Hotel Gracery Shinjuku" },
    { dayNumber: 2, date: "2026-08-11", accommodationName: null },
    { dayNumber: 3, date: "2026-08-12", accommodationName: "Ryokan Kurashiki" },
  ]

  it("returns an empty string when there is nothing to show", () => {
    assert.equal(buildTripShapeCtx([], 1), "")
  })

  it("lists every day with its date and stay", () => {
    // Day generation only ever saw its OWN day plus a flat list of other days'
    // activity names — it could not see the trip's shape at all.
    const out = buildTripShapeCtx(days, 2)
    assert.ok(out.includes("Day 1"))
    assert.ok(out.includes("Day 3"))
    assert.ok(out.includes("Ryokan Kurashiki"))
  })

  it("marks the day being planned", () => {
    const out = buildTripShapeCtx(days, 2)
    const marked = out.split("\n").filter((l) => l.includes("PLANNING NOW"))
    assert.equal(marked.length, 1)
    assert.ok(marked[0]!.includes("Day 2"))
  })

  it("carries a multi-night stay forward instead of showing a gap", () => {
    // Day 2 sets no accommodation of its own: the traveler is still at Day 1's
    // hotel. Rendering it blank reads as "no stay booked" and invites the model
    // to treat the day as unanchored.
    const out = buildTripShapeCtx(days, 1)
    const day2 = out.split("\n").find((l) => l.includes("Day 2"))
    assert.ok(day2?.includes("Hotel Gracery Shinjuku"))
  })

  it("does not invent a stay before the first one is known", () => {
    const out = buildTripShapeCtx(
      [{ dayNumber: 1, date: "2026-08-10", accommodationName: null }, ...days.slice(1)],
      1,
    )
    const day1 = out.split("\n").find((l) => l.includes("Day 1"))
    assert.ok(!day1?.includes("staying at"))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/ai.test.ts`
Expected: FAIL — `buildNextStayCtx` is not exported.

- [ ] **Step 3: Implement `buildNextStayCtx`**

In `server/lib/ai.ts`, add next to `buildFlightsCtx`:

```ts
/**
 * Context for the stay the traveler moves to AFTER tonight.
 *
 * Generation only ever looked BACKWARDS (previousStayDay filters
 * `dayNumber < day.dayNumber`), so it could not know the traveler relocates
 * tomorrow — and would happily end today far from where tomorrow starts.
 *
 * Gated behind thinking mode: this is extra prompt weight that only pays off on
 * multi-base trips, unlike the coordinate fixes which are plain defects.
 *
 * Returns "" when the traveler does not actually move — "you relocate to Hotel X"
 * while already at Hotel X invites the model to invent a transfer.
 */
export function buildNextStayCtx(
  next?: { name: string; address: string | null; lat?: number | null; lng?: number | null } | null,
  tonight?: { name: string } | null,
): string {
  if (!next) return ""
  const norm = (s: string) => s.trim().toLowerCase()
  if (tonight && norm(tonight.name) === norm(next.name)) return ""
  return `\nNEXT BASE (the traveler relocates after tonight): ${formatAnchor(next)}
RELOCATION RULE: they sleep somewhere else tomorrow. Bias the late-afternoon and evening stops toward the side of the region that SHORTENS tomorrow's transfer, and never end today somewhere that leaves them far from that next base. Do not schedule tomorrow's activities — this is only about where today should finish.`
}
```

- [ ] **Step 3b: Implement `buildTripShapeCtx`**

In `server/lib/ai.ts`, add directly below `buildNextStayCtx`:

```ts
/**
 * The whole trip's day-by-day shape: date, stay, and which day is in scope.
 *
 * Day generation otherwise sees only its own day plus a flat list of other
 * days' activity NAMES (ai.post.ts's otherDayActivities) — enough to avoid
 * duplicates, nowhere near enough to reason about the trip's geography.
 *
 * Carries a stay forward across nights that set none of their own, mirroring
 * discuss-context.ts's `carriedAccommodation`: on a three-night stay only the
 * first day holds the accommodation row, and rendering the rest blank reads as
 * "nothing booked" rather than "same hotel".
 *
 * Gated behind thinking mode — this is real prompt weight on every call.
 */
export function buildTripShapeCtx(
  days: { dayNumber: number; date: string; accommodationName: string | null }[],
  planningDayNumber: number,
): string {
  if (days.length === 0) return ""
  let carried: string | null = null
  const lines = days
    .toSorted((a, b) => a.dayNumber - b.dayNumber)
    .map((d) => {
      if (d.accommodationName) carried = d.accommodationName
      const stay = carried ? ` · staying at ${carried}` : ""
      const here = d.dayNumber === planningDayNumber ? " · PLANNING NOW" : ""
      return `- Day ${d.dayNumber} (${d.date})${stay}${here}`
    })
  return `\nTRIP SHAPE (context only — plan ONLY the day marked PLANNING NOW):\n${lines.join("\n")}`
}
```

- [ ] **Step 4: Thread `nextLocation`, `tripShape`, and `thinking` into the handlers**

In `server/lib/ai.ts`:

Add to `handleAdd`'s params (~line 413) and `handleFillGaps`'s params (~line 527):

```ts
    /** Only populated in thinking mode — see buildNextStayCtx. */
    nextLocation?: StartLocation
    /** Only populated in thinking mode — see buildTripShapeCtx. */
    tripShape?: { dayNumber: number; date: string; accommodationName: string | null }[]
```

Add to both prompt strings, immediately after the `buildFlightsCtx(...)` interpolation:

```ts
${buildNextStayCtx(params.nextLocation, params.accommodation)}${params.tripShape ? buildTripShapeCtx(params.tripShape, params.dayNumber) : ""}
```

Add to `processUserRequest`'s params (after `startLocation?: StartLocation` at ~line 873):

```ts
  /** Where the traveler moves to after tonight. Only passed in thinking mode. */
  nextLocation?: StartLocation
  /** Every day's date and stay. Only passed in thinking mode. */
  tripShape?: { dayNumber: number; date: string; accommodationName: string | null }[]
  /**
   * Traveler opted into deeper reasoning for this request. Selects provider
   * options and unlocks the wider prompt context. Never trust the raw client
   * value — the endpoint has already ANDed it with thinkingAvailable().
   */
  thinking?: boolean
```

Forward `nextLocation: params.nextLocation` and `tripShape: params.tripShape` into the `handleAdd` and `handleFillGaps` calls in the intent switch (~935, ~983).

- [ ] **Step 5: Route provider options through the flag**

In `server/lib/ai.ts`, change the import from `./ai-config` to include `aiProviderOptions`, then replace every `providerOptions: AI_PROVIDER_OPTIONS` inside a handler that receives `thinking` with:

```ts
      providerOptions: aiProviderOptions(params.thinking ?? false),
```

Add `thinking?: boolean` to the params of `handleAdd`, `handleFillGaps`, `handleOptimize`, `handleReschedule`, and `handleAccommodation`, and forward `thinking: params.thinking` from `processUserRequest`'s intent switch to each. Leave `handleRemove` on `AI_PROVIDER_OPTIONS` — it is a pure text-classification call with nothing to reason about.

- [ ] **Step 6: Compute `nextStayDay` in the endpoint**

In `server/api/trips/[id]/days/[dayId]/ai.post.ts`, immediately after the `startLocation` block (currently ending at line 175), add:

```ts
// The forward counterpart of previousStayDay. Only used in thinking mode:
// it is what lets generation see that the traveler relocates tomorrow and
// finish today on the right side of the region.
const nextStayDay = allTripDays
  .filter((d) => d.dayNumber > day.dayNumber && d.accommodationName)
  .toSorted((a, b) => a.dayNumber - b.dayNumber)[0]
const nextLocation = nextStayDay?.accommodationName
  ? {
      name: nextStayDay.accommodationName,
      address: nextStayDay.accommodationAddress,
      lat: nextStayDay.accommodationLat,
      lng: nextStayDay.accommodationLng,
    }
  : null
```

and pass both into `processUserRequest`, right after the `startLocation` property:

```ts
        nextLocation: thinking && nextLocation ? nextLocation : undefined,
        tripShape: thinking
          ? allTripDays.map((d) => ({
              dayNumber: d.dayNumber,
              date: d.date,
              accommodationName: d.accommodationName,
            }))
          : undefined,
```

`allTripDays` is already fetched at :154-159, but its `columns` selection must
now include `date` and `accommodationName` — add them to the `findMany` if the
query narrows columns.

(`thinking` is defined by Task 5; implement Task 5 in the same session or temporarily hardcode `false` and let Task 5's test catch it.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test server/lib/ai.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/lib/ai.ts server/lib/ai.test.ts "server/api/trips/[id]/days/[dayId]/ai.post.ts"
git commit -m "feat(ai): add gated next-stay lookahead to day generation"
```

---

### Task 5: Day-generation endpoint wiring

**Files:**

- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts:26-42` (body schema), `:133-138` (`refundOnce`), `:140-146` (consume)
- Test: `server/lib/ai-config.test.ts` (pricing helper only — the endpoint itself is not unit-testable outside Nitro)

**Interfaces:**

- Consumes: `THINKING_CREDIT_MULTIPLIER` (Task 1), `refundAiCredit(userId, month, amount)` (Task 1), `thinkingAvailable()` (Task 2), `processUserRequest({ thinking, nextLocation })` (Task 4).
- Produces: the endpoint accepts `thinking?: boolean` in its body.

- [ ] **Step 1: Add `thinking` to the body schema**

In `server/api/trips/[id]/days/[dayId]/ai.post.ts`, extend `aiBodySchema` (lines 26-42):

```ts
  /**
   * Traveler opted into deeper reasoning for this request. Untrusted: the
   * handler ANDs it with thinkingAvailable() before it can affect the model
   * OR the price. Defaults false so the full-itinerary loop — which generates
   * every day and would otherwise cost 3x per day — is never silently upgraded.
   */
  thinking: z.boolean().optional().default(false),
```

Destructure it at line 47:

```ts
const {
  prompt: rawPrompt,
  intent,
  runId,
  thinking: thinkingRequested,
} = await readValidatedBody(event, aiBodySchema.parse)
```

- [ ] **Step 2: Resolve the effective mode and its price**

Add immediately after the destructure, before the sanitize block:

```ts
// Resolve ONCE, here, and use this everywhere below. A request that asks for
// thinking while the Gemini fallback is active would otherwise be charged 3x
// for a call that provably never reasoned.
const thinking = thinkingRequested && thinkingAvailable()
const creditsCharged = thinking ? THINKING_CREDIT_MULTIPLIER : 1
```

Add the imports:

```ts
import { thinkingAvailable } from "../../../../../lib/ai-config"
import { THINKING_CREDIT_MULTIPLIER } from "../../../../../utils/ai-credit-cost"
```

- [ ] **Step 3: Make the refund guard amount-aware**

Replace `refundOnce` (lines 133-138):

```ts
let creditRefunded = false
const refundOnce = async (usageMonth: string): Promise<void> => {
  if (creditRefunded) return
  creditRefunded = true
  // Refund what was actually charged, not a hard-coded 1. A thinking-mode
  // generation consumes `creditsCharged` up front; refunding 1 of 3 on a 502
  // silently pocketed the other 2 on every failure.
  await refundAiCredit(session.user.id, usageMonth, creditsCharged)
}
```

- [ ] **Step 4: Charge the multiplier up front**

In `generate`, immediately after `const usageMonth = await tryConsumeAiCredit(session.user.id)` (line 145):

```ts
// tryConsumeAiCredit takes exactly one credit and owns the 429 gate. Charge
// the remainder right here — before the model call, so the work is never
// given away, and matched by refundOnce on every failure path below.
await chargeExtraAiCredits(session.user.id, creditsCharged - 1, usageMonth)
```

Add `chargeExtraAiCredits` to the existing `ai-limits` import at line 18. Note the argument order: **`(userId, extra, month)`**.

- [ ] **Step 5: Pass `thinking` into the model call**

In the `processUserRequest({...})` call, add after `flights,`:

```ts
        thinking,
```

and confirm the `nextLocation` line added in Task 4 Step 6 now references the real `thinking` binding.

- [ ] **Step 6: Verify the full-itinerary loop is unaffected**

Run: `bun test app/composables/useGenerateFullItinerary.test.ts`
Expected: PASS unchanged — it posts `{ prompt, intent, runId }` with no `thinking`, which zod defaults to `false`.

- [ ] **Step 7: Typecheck**

Run: `bunx nuxi typecheck 2>&1 | tail -5`
Expected: baseline error count unchanged.

- [ ] **Step 8: Commit**

```bash
git add "server/api/trips/[id]/days/[dayId]/ai.post.ts"
git commit -m "feat(ai): accept and price the thinking flag on day generation"
```

---

### Task 6: Surface reasoning deltas on the stream

**Files:**

- Modify: `server/lib/discuss-stream.ts:60`, `:79-105`
- Modify: `shared/utils/discuss-sse.ts:86-107`
- Test: `server/lib/discuss-stream.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `DiscussStreamEvent` gains `{ type: "thinking"; delta: string }`
  - `DiscussSseEvent` gains `{ event: "thinking"; data: { delta: string } }`

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/discuss-stream.test.ts`:

```ts
describe("mapChunk reasoning deltas", () => {
  it("surfaces a reasoning delta as a thinking event", () => {
    // Until now mapChunk returned null for every non-text, non-tool chunk, so
    // thinking mode produced a long silence and looked like a hang. This event
    // is the entire reason the 8x-slower mode is usable.
    assert.deepEqual(
      mapChunk({ type: "reasoning-delta", payload: { text: "Checking the hotel's side of town" } }),
      { type: "thinking", delta: "Checking the hotel's side of town" },
    )
  })

  it("drops zero-length reasoning deltas, matching text-delta behaviour", () => {
    assert.equal(mapChunk({ type: "reasoning-delta", payload: { text: "" } }), null)
  })

  it("drops a malformed reasoning payload rather than throwing", () => {
    assert.equal(mapChunk({ type: "reasoning-delta", payload: null }), null)
    assert.equal(mapChunk({ type: "reasoning-delta", payload: { text: 42 } }), null)
    assert.equal(mapChunk({ type: "reasoning-delta" }), null)
  })

  it("still ignores chunk types it does not know", () => {
    assert.equal(mapChunk({ type: "step-finish", payload: {} }), null)
    assert.equal(mapChunk({ type: "finish", payload: {} }), null)
  })

  it("keeps text and reasoning in separate channels", () => {
    // A reasoning delta must never be appended to the reply body — it is not
    // the assistant's answer and is deliberately not persisted.
    const reasoning = mapChunk({ type: "reasoning-delta", payload: { text: "hmm" } })
    const text = mapChunk({ type: "text-delta", payload: { text: "hmm" } })
    assert.notDeepEqual(reasoning, text)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/lib/discuss-stream.test.ts`
Expected: FAIL — `mapChunk` returns `null` for `reasoning-delta`.

- [ ] **Step 3: Extend the stream event union and mapper**

In `server/lib/discuss-stream.ts`, replace line 60:

```ts
export type DiscussStreamEvent =
  | { type: "tool"; line: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
```

Add the mapper branch inside `mapChunk`, before the final `return null` at line 104:

```ts
// Reasoning content from DeepSeek thinking mode. Surfaced live but NEVER
// persisted and never counted as delivered value — see discuss.post.ts.
if (chunk.type === "reasoning-delta") {
  const payload = asTextDeltaPayload(chunk.payload)
  if (!payload || payload.text.length === 0) return null
  return { type: "thinking", delta: payload.text }
}
```

Update the doc comment above `mapChunk` (lines 79-83) to mention the third surfaced type.

- [ ] **Step 4: Extend the wire contract**

In `shared/utils/discuss-sse.ts`, add to the `DiscussSseEvent` union:

```ts
  /**
   * Live reasoning from thinking mode. Display-only: it is not part of the
   * reply, is not persisted, and does not count toward whether the turn
   * delivered value (a turn that only reasoned is still refunded).
   */
  | { event: "thinking"; data: { delta: string } }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test server/lib/discuss-stream.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/lib/discuss-stream.ts server/lib/discuss-stream.test.ts shared/utils/discuss-sse.ts
git commit -m "feat(discuss): surface reasoning deltas as a thinking SSE event"
```

---

### Task 6b: Deliver provider options where Mastra actually reads them

Added after a pre-flight finding, not present in the original spec. Task 7
depends on this being correct, so it lands first.

**The finding:** `providerOptions` is a valid **per-call** option on
`agent.stream(...)` / `agent.generate(...)`
(`@mastra/core/dist/agent/agent.types.d.ts:419`), but is **not** a field on the
Agent constructor's `AgentConfig` — passing it there is one of the 18 baseline
typecheck errors (`server/lib/itinerary-review-ai.ts:345`). Two agents pass it
in the constructor anyway. At runtime Mastra resolves provider options from the
model config (`llm.getProviderOptions()` → `#firstModel.providerOptions`), so a
top-level constructor field appears to be dropped — meaning DeepSeek thinking
mode may never have been disabled for either agent.

**Files:**

- Modify: `server/lib/discuss-agent.ts:56-63`
- Modify: `server/lib/itinerary-review-ai.ts:339-346` and its `agent.generate(...)` call
- Modify: `server/api/trips/[id]/discuss.post.ts` (add the per-call option)
- Test: `server/lib/ai-config.test.ts`

**Interfaces:**

- Consumes: `AI_PROVIDER_OPTIONS` (unchanged), `aiProviderOptions` (Task 2).
- Produces: no new exports. Both agents stop passing `providerOptions` to their
  constructors; both call sites pass it per call instead.

- [ ] **Step 1: Establish the ground truth before changing anything**

Record what is actually true, so the fix is evidence-led rather than assumed:

```bash
# 1. Confirm AgentConfig rejects the constructor field (expect a TS2353 hit):
bunx nuxi typecheck 2>&1 | grep -c "providerOptions.*does not exist in type 'AgentConfig"

# 2. Confirm the per-call option IS declared:
grep -n "providerOptions" node_modules/@mastra/core/dist/agent/agent.types.d.ts

# 3. Confirm where the runtime reads it from:
grep -n "getProviderOptions()" node_modules/@mastra/core/dist/chunk-OE4IEL7C.js
```

Write what each command returned into the report file. If the evidence
contradicts the finding above — for example if `AgentConfig` does accept the
field in this installed version — **stop and report NEEDS_CONTEXT rather than
proceeding**. The rest of this task assumes the finding holds.

- [ ] **Step 2: Write the failing regression test**

Append to `server/lib/ai-config.test.ts`:

```ts
describe("provider options reach the model", () => {
  it("keeps thinking disabled by default in the shared constant", () => {
    // The whole point of AI_PROVIDER_OPTIONS: DeepSeek V4 defaults to a hidden
    // reasoning phase. If this constant is ever passed somewhere the runtime
    // does not read, thinking is silently ON everywhere it is relied upon.
    assert.deepEqual(AI_PROVIDER_OPTIONS, { deepseek: { thinking: { type: "disabled" } } })
  })

  it("no agent constructor carries providerOptions", async () => {
    // Regression guard for the pre-flight finding: AgentConfig has no such
    // field, so a constructor-level value is dropped at runtime AND fails
    // typecheck. Provider options must be passed per call instead.
    const files = [
      "server/lib/discuss-agent.ts",
      "server/lib/itinerary-review-ai.ts",
      "server/lib/ai.ts",
    ]
    const { readFile } = await import("node:fs/promises")
    for (const f of files) {
      const src = await readFile(new URL(`../../${f}`, import.meta.url), "utf8")
      // Match `providerOptions` appearing inside a `new Agent({ ... })` literal.
      const agentBlocks = src.match(/new Agent\(\{[\s\S]*?\n\s*\}\)/g) ?? []
      for (const block of agentBlocks) {
        assert.ok(
          !block.includes("providerOptions"),
          `${f}: new Agent({...}) must not set providerOptions — AgentConfig has no such field, so it is dropped`,
        )
      }
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test server/lib/ai-config.test.ts`
Expected: FAIL — `discuss-agent.ts` and `itinerary-review-ai.ts` both set
`providerOptions` inside `new Agent({...})`.

- [ ] **Step 4: Remove the dropped constructor field from the discuss agent**

In `server/lib/discuss-agent.ts`, delete the `providerOptions: AI_PROVIDER_OPTIONS`
line from the `new Agent({...})` literal (line 63) and its two comment lines
above it, replacing them with a pointer to where the option now lives:

```ts
  model: getModel("discuss"),
  // Provider options are passed PER CALL at the stream site, not here:
  // AgentConfig has no providerOptions field, so a value set here is dropped
  // at runtime (and fails typecheck — see itinerary-review-ai.ts's copy of
  // this same mistake). See discuss.post.ts's stream call.
```

Drop `AI_PROVIDER_OPTIONS` from the file's import if nothing else uses it.

- [ ] **Step 5: Pass it per call at the discuss stream site**

In `server/api/trips/[id]/discuss.post.ts`, add to the `discussAgent.stream(...)`
options object:

```ts
        providerOptions: AI_PROVIDER_OPTIONS,
```

and import `AI_PROVIDER_OPTIONS` from `../../../lib/ai-config`. Task 7 replaces
this value with `aiProviderOptions(thinking)`; this step exists so the branch is
correct even if Task 7 is deferred.

- [ ] **Step 6: Do the same for the reviewer agent**

In `server/lib/itinerary-review-ai.ts`, delete `providerOptions: AI_PROVIDER_OPTIONS`
from the `new Agent({...})` literal (line 345) and add it to the `agent.generate(...)`
call's options object instead. This clears one of the 18 baseline typecheck
errors — the baseline becomes 17.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test server/lib/ai-config.test.ts server/lib/itinerary-review-ai.test.ts server/lib/discuss-agent.test.ts`
Expected: PASS

- [ ] **Step 8: Confirm the typecheck baseline improved**

Run: `bunx nuxi typecheck 2>&1 | grep -cE "error TS"`
Expected: **45** — exactly one fewer than the 46-error baseline, with the
`AgentConfig` / `providerOptions` error gone. Any other number means something
else moved; report it rather than proceeding.

- [ ] **Step 9: Commit**

```bash
git add server/lib/discuss-agent.ts server/lib/itinerary-review-ai.ts server/lib/ai-config.test.ts "server/api/trips/[id]/discuss.post.ts"
git commit -m "fix(ai): pass provider options per call, where Mastra actually reads them"
```

---

### Task 7: Discuss endpoint wiring — pricing, step ceiling, wall-clock guard

**Files:**

- Modify: `server/api/trips/[id]/discuss.post.ts:29-40` (body schema), `:66-93` (`settleCredits`), `:292-341` (stream loop)
- Test: `server/utils/ai-credit-cost.test.ts` (guard logic extracted to a pure helper)

**Interfaces:**

- Consumes: `discussStepCeiling`, `creditsForSteps(steps, ceiling)`, `THINKING_CREDIT_MULTIPLIER` (Task 1); `thinkingAvailable()` (Task 2); `aiProviderOptions` (Task 2); the `thinking` SSE event (Task 6).
- Produces: `shouldStripTools(stepNumber: number, ceiling: number, elapsedMs: number): boolean`

- [ ] **Step 1: Write the failing test for the guard**

Append to `server/utils/ai-credit-cost.test.ts` (add `shouldStripTools` and `TURN_TIME_BUDGET_MS` to the import):

```ts
describe("shouldStripTools", () => {
  it("leaves tools available early in a normal turn", () => {
    assert.equal(shouldStripTools(0, MAX_DISCUSS_STEPS, 0), false)
    assert.equal(shouldStripTools(5, MAX_DISCUSS_STEPS, 10_000), false)
  })

  it("strips tools on the last permitted step so the turn always writes a reply", () => {
    // Pre-existing behaviour: without this the loop could end on a tool call and
    // the user got silence.
    assert.equal(shouldStripTools(MAX_DISCUSS_STEPS - 1, MAX_DISCUSS_STEPS, 0), true)
  })

  it("strips tools once the time budget is spent, even with steps to spare", () => {
    // The guard that makes the raised thinking ceiling safe. 40 thinking steps
    // can exceed Vercel's 300s limit, and a timeout kills the process before the
    // refund runs — billing 3x for nothing.
    assert.equal(shouldStripTools(3, MAX_DISCUSS_STEPS_THINKING, TURN_TIME_BUDGET_MS + 1), true)
  })

  it("does not strip just below the time budget", () => {
    assert.equal(shouldStripTools(3, MAX_DISCUSS_STEPS_THINKING, TURN_TIME_BUDGET_MS - 1), false)
  })

  it("leaves headroom for the final reply inside the 300s function limit", () => {
    // The model still has to WRITE the answer after tools are stripped.
    assert.ok(TURN_TIME_BUDGET_MS <= 200_000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/utils/ai-credit-cost.test.ts`
Expected: FAIL — `shouldStripTools` and `TURN_TIME_BUDGET_MS` are not exported.

- [ ] **Step 3: Implement the guard**

Append to `server/utils/ai-credit-cost.ts`:

```ts
/**
 * Wall-clock budget for one discuss turn's TOOL phase.
 *
 * Vercel's function limit is 300s. Tools are stripped at this mark so the model
 * still has ~100s to write its reply inside that limit. This is what makes
 * MAX_DISCUSS_STEPS_THINKING safe: step count is a poor proxy for time when
 * thinking mode runs ~8x slower per step, and a timeout kills the process
 * before the endpoint's refund can run.
 */
export const TURN_TIME_BUDGET_MS = 200_000

/**
 * Whether this step must run without tools — either it is the last permitted
 * step, or the turn has spent its time budget.
 *
 * Pure so the policy is testable; the endpoint supplies the elapsed time.
 */
export function shouldStripTools(stepNumber: number, ceiling: number, elapsedMs: number): boolean {
  if (elapsedMs > TURN_TIME_BUDGET_MS) return true
  return ceiling - stepNumber <= 1
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/utils/ai-credit-cost.test.ts`
Expected: PASS

- [ ] **Step 5: Add `thinking` to the discuss body schema**

In `server/api/trips/[id]/discuss.post.ts`, extend `discussBodySchema` (lines 29-40):

```ts
  /**
   * Traveler opted into deeper reasoning for this turn. Untrusted — ANDed with
   * thinkingAvailable() below before it can affect the model or the price.
   */
  thinking: z.boolean().optional().default(false),
```

After `const trip = ...` and its 404 check (line 56), add:

```ts
// Resolved once. Without a DeepSeek key getModel serves Gemini, which ignores
// deepseek-namespaced provider options — charging the multiplier there would
// bill 3x for a turn that never reasoned.
const thinking = body.thinking && thinkingAvailable()
const stepCeiling = discussStepCeiling(thinking)
```

Update the imports:

```ts
import {
  creditsForSteps,
  discussStepCeiling,
  shouldStripTools,
  STEPS_PER_CREDIT,
  THINKING_CREDIT_MULTIPLIER,
} from "../../../utils/ai-credit-cost"
import { thinkingAvailable } from "../../../lib/ai-config"
```

`MAX_DISCUSS_STEPS` is no longer referenced directly — remove it from the import if nothing else uses it.

- [ ] **Step 6: Multiply the settle**

In `settleCredits` (lines 76-93), replace the body after the `settled = true` line:

```ts
if (!streamedAny) {
  // Exactly 1, in BOTH modes. Unlike day generation, discuss charges the
  // remainder at settle time rather than up front — so a turn that reaches
  // this branch has only ever consumed the single tryConsumeAiCredit
  // credit. Refunding the multiplier here would mint the user free credits.
  await refundAiCredit(session.user.id, usageMonth, 1)
  return 0
}
// The ceiling must match the one the turn actually ran under, or a 40-step
// thinking turn bills as though it had stopped at 30.
const creditsUsed =
  creditsForSteps(steps, stepCeiling) * (thinking ? THINKING_CREDIT_MULTIPLIER : 1)
await chargeExtraAiCredits(session.user.id, creditsUsed - 1, usageMonth)
return creditsUsed
```

The asymmetry between the two endpoints is deliberate and worth holding onto: **day generation charges up front and therefore refunds the multiplier; discuss charges at settle and therefore refunds 1.** Getting this backwards on either side silently mints or steals credits on every failed turn.

- [ ] **Step 7: Apply the ceiling and the guard to the stream call**

In the `discussAgent.stream(...)` options (lines 292-317), replace `maxSteps` and `prepareStep`:

```ts
const turnStartedAt = Date.now()
const result = await discussAgent.stream(agentMessages, {
  toolsets: { discuss: tools },
  maxSteps: stepCeiling,
  providerOptions: aiProviderOptions(thinking),
  prepareStep: ({ stepNumber }) => {
    // Two independent reasons to drop the toolset: the step ceiling is
    // one away, or the turn has spent its wall-clock budget. The second
    // is what keeps the raised thinking ceiling inside the 300s function
    // limit — a timeout would kill the process before settleCredits runs.
    if (shouldStripTools(stepNumber, stepCeiling, Date.now() - turnStartedAt)) {
      return { activeTools: [] }
    }
    const remaining = stepCeiling - stepNumber
    return {
      instructions: `${DISCUSS_SYSTEM_PROMPT}

[Runtime] You have ${remaining} tool-call steps left this turn. Every ${STEPS_PER_CREDIT} steps costs the user one AI credit from a small monthly allowance, so treat searching as spending their money: research only what you will actually propose. On your last step the tools are removed and you must write your reply, so wind down before then.`,
    }
  },
  abortSignal: controller.signal,
})
```

Add `aiProviderOptions` to the `ai-config` import from Step 5.

- [ ] **Step 8: Forward thinking chunks, and keep them out of the reply**

In the `for await (const chunk of result.fullStream)` loop (lines 319-341), replace the mapped-event dispatch:

```ts
const mapped = mapChunk(chunk)
if (!mapped) continue
if (mapped.type === "tool") {
  toolLines.push(mapped.line)
  await stream.push(toSseFrame({ event: "tool", data: { line: mapped.line } }))
} else if (mapped.type === "thinking") {
  // Display-only. Deliberately NOT appended to streamedText: reasoning
  // is not the reply, must not be persisted, and must not make
  // `streamedAny` true — a turn that only thought delivered nothing and
  // is still refunded below.
  await stream.push(toSseFrame({ event: "thinking", data: { delta: mapped.delta } }))
} else {
  streamedText += mapped.delta
  await stream.push(toSseFrame({ event: "text", data: { delta: mapped.delta } }))
}
```

- [ ] **Step 9: Verify**

Run: `bun test server/utils/ai-credit-cost.test.ts server/lib/discuss-stream.test.ts` then `bunx nuxi typecheck 2>&1 | tail -5`
Expected: PASS; typecheck baseline unchanged.

- [ ] **Step 10: Commit**

```bash
git add "server/api/trips/[id]/discuss.post.ts" server/utils/ai-credit-cost.ts server/utils/ai-credit-cost.test.ts
git commit -m "feat(discuss): thinking-mode pricing, raised step ceiling, and wall-clock guard"
```

---

### Task 8: Client — toggle, request wiring, and the thinking disclosure

**Files:**

- Create: `app/composables/useThinkingMode.ts`
- Create: `app/composables/useThinkingMode.test.ts`
- Modify: `app/components/AiDock.vue:76-104` (`ChatMessage`), `:847-860` (rendering), composer area
- Modify: `app/pages/trips/[id].vue:982-1051` (request + SSE), `:1317-1319` (quick fill gaps)
- Modify: `server/api/ai/usage.get.ts` (report `thinkingAvailable` to the client)

**Interfaces:**

- Consumes: the `thinking` SSE event (Task 6); the `thinking` body field on both endpoints (Tasks 5, 7).
- Produces:
  - `useThinkingMode(): { enabled: Ref<boolean>; toggle: () => void }`
  - `ChatMessage` gains `thinkingText?: string`

- [ ] **Step 1: Write the failing composable test**

Create `app/composables/useThinkingMode.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import { readThinkingMode, writeThinkingMode, THINKING_MODE_KEY } from "./useThinkingMode"

/** Minimal in-memory Storage stand-in — the composable must not depend on a DOM. */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe("thinking mode persistence", () => {
  let store: Storage
  beforeEach(() => {
    store = fakeStorage()
  })

  it("defaults to off when nothing is stored", () => {
    // Opt-in, always. Thinking mode costs 3x; it must never be on by accident.
    assert.equal(readThinkingMode(store), false)
  })

  it("round-trips an enabled value", () => {
    writeThinkingMode(store, true)
    assert.equal(readThinkingMode(store), true)
  })

  it("round-trips a disabled value", () => {
    writeThinkingMode(store, true)
    writeThinkingMode(store, false)
    assert.equal(readThinkingMode(store), false)
  })

  it("treats a corrupt stored value as off rather than throwing", () => {
    store.setItem(THINKING_MODE_KEY, "not-a-bool")
    assert.equal(readThinkingMode(store), false)
  })

  it("survives storage being unavailable (private mode, SSR)", () => {
    const throwing: Storage = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }
    assert.equal(readThinkingMode(throwing), false)
    assert.doesNotThrow(() => writeThinkingMode(throwing, true))
  })

  it("returns false when no storage exists at all", () => {
    assert.equal(readThinkingMode(null), false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test app/composables/useThinkingMode.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the composable**

Create `app/composables/useThinkingMode.ts`:

```ts
/**
 * The traveler's thinking-mode preference.
 *
 * sessionStorage, not localStorage: thinking mode costs 3x credits, and a
 * preference that survives browser restarts is a preference people forget is
 * on. Clearing it with the tab is the intended safety valve.
 *
 * The read/write helpers take the Storage explicitly so they are unit-testable
 * without a DOM, and so SSR (where there is no sessionStorage) is a plain null.
 */
export const THINKING_MODE_KEY = "ai-trip.thinking-mode"

export function readThinkingMode(store: Storage | null): boolean {
  if (!store) return false
  try {
    return store.getItem(THINKING_MODE_KEY) === "true"
  } catch {
    // Private-mode / blocked storage. Off is the safe answer: it never spends
    // credits the traveler did not ask to spend.
    return false
  }
}

export function writeThinkingMode(store: Storage | null, value: boolean): void {
  if (!store) return
  try {
    store.setItem(THINKING_MODE_KEY, String(value))
  } catch {
    // Preference simply does not persist this session. Not worth surfacing.
  }
}

export function useThinkingMode() {
  const enabled = useState("thinking-mode", () => false)

  // Hydrate on the client only — sessionStorage does not exist during SSR, and
  // reading it in setup would make the server and client render disagree.
  onMounted(() => {
    enabled.value = readThinkingMode(import.meta.client ? window.sessionStorage : null)
  })

  function toggle() {
    enabled.value = !enabled.value
    writeThinkingMode(import.meta.client ? window.sessionStorage : null, enabled.value)
  }

  return { enabled, toggle }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test app/composables/useThinkingMode.test.ts`
Expected: PASS

- [ ] **Step 5: Carry reasoning text on the message**

In `app/components/AiDock.vue`, add to the `ChatMessage` interface (after `toolCallSummary` at line 86):

```ts
  /**
   * Live reasoning from thinking mode. Display-only and never persisted — the
   * server does not store it and a reloaded transcript will not have it.
   */
  thinkingText?: string
```

- [ ] **Step 6: Render the disclosure**

In `app/components/AiDock.vue`, inside the assistant-message block, immediately before the `v-if="msg.toolCallSummary?.length"` div at line 847:

```vue
<details v-if="msg.thinkingText" class="dock-thinking">
                <summary class="dock-thinking-summary">
                  <Icon name="lucide:brain" class="dock-tool-icon" />
                  <span>Thinking</span>
                </summary>
                <p class="dock-thinking-body">{{ msg.thinkingText }}</p>
              </details>
```

Add to the component's `<style>` block, next to `.dock-tool-line` (line 1371):

```css
.dock-thinking {
  @apply rounded-lg bg-white/60 px-2 py-1 text-xs;
}
.dock-thinking-summary {
  @apply flex cursor-pointer items-center gap-1 opacity-70;
}
.dock-thinking-body {
  @apply mt-1 whitespace-pre-wrap opacity-60;
}
```

Note: `bg-white` is used bare and unprefixed on purpose — the global dark-mode override only matches the bare selector, so a breakpoint-prefixed variant would stay stark white in dark mode.

- [ ] **Step 7: Add the composer toggle**

In `app/components/AiDock.vue`, add to the props (after `dayLabels` at line 116):

```ts
thinking: boolean
thinkingAvailable: boolean
```

and to the emits (after `optimizeRoute` at line 129):

```ts
  "update:thinking": [value: boolean]
```

Render a switch next to the send button in the composer:

```vue
<button
  v-if="thinkingAvailable"
  type="button"
  class="dock-thinking-toggle"
  :aria-pressed="thinking"
  :title="
    thinking ? 'Thinking mode on — deeper reasoning, costs 3 credits per turn' : 'Thinking mode off'
  "
  @click="emit('update:thinking', !thinking)"
>
          <Icon name="lucide:brain" class="dock-tool-icon" />
          <span>{{ thinking ? "Thinking · 3×" : "Think" }}</span>
        </button>
```

```css
.dock-thinking-toggle {
  @apply flex items-center gap-1 rounded-full px-2 py-1 text-xs opacity-60;
}
.dock-thinking-toggle[aria-pressed="true"] {
  @apply bg-cta text-white opacity-100;
}
```

`bg-cta` is the non-mirroring fill token — correct under white text in both themes.

- [ ] **Step 7b: Let the client learn whether thinking mode is available**

The toggle must be hidden when the server cannot honour it, and the client has
no view of `DEEPSEEK_API_KEY`. Extend the existing usage endpoint rather than
adding a route — the dock already consumes it for the credit counter.

`server/api/ai/usage.get.ts`:

```ts
import { thinkingAvailable } from "../../lib/ai-config"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const usage = await getAiUsage(session.user.id)
  // The client cannot see DEEPSEEK_API_KEY, and a toggle that silently does
  // nothing (Gemini fallback) is worse than no toggle at all.
  return { ...usage, thinkingAvailable: thinkingAvailable() }
})
```

In `app/pages/trips/[id].vue`, widen the type on the existing usage fetch to
include `thinkingAvailable: boolean` and hold it in a ref for the dock binding.

- [ ] **Step 8: Send `thinking` and consume the SSE event**

In `app/pages/trips/[id].vue`:

Near the other composable calls, add:

```ts
const { enabled: thinkingEnabled, toggle: toggleThinking } = useThinkingMode()
```

Add to the discuss request body (line 991, after `dayId`):

```ts
      thinking: thinkingEnabled.value,
```

Add a branch to the SSE dispatch, between the `text` and `done` branches (line 1034):

```ts
        } else if (frame.event === "thinking") {
          const { delta } = payload as Extract<DiscussSseEvent, { event: "thinking" }>["data"]
          patch((m) => ({ ...m, thinkingText: (m.thinkingText ?? "") + delta }))
```

Add `thinking` to the quick fill-gaps body (line 1319):

```ts
      body: {
        prompt: "Fill the gaps in this day",
        intent: "fill_gaps",
        thinking: thinkingEnabled.value,
      },
```

Bind the dock, using the real server-reported availability from Step 7b:

```vue
:thinking="thinkingEnabled" :thinking-available="aiThinkingAvailable"
@update:thinking="toggleThinking"
```

Do **not** touch `app/composables/useGenerateFullItinerary.ts` — the full-trip loop must keep posting without `thinking`.

- [ ] **Step 9: Verify the build**

Run: `bun test app/composables/` then `bunx nuxi typecheck 2>&1 | tail -5` then `bunx nuxi build`
Expected: tests PASS; typecheck baseline unchanged; build succeeds. The build step is not optional — typecheck does not catch Vue template compile errors.

- [ ] **Step 10: Runtime spot-check**

Drive the real app in a browser: open a trip, toggle thinking on, send a discuss message. Confirm the "Thinking" disclosure appears and fills while the reply is still forming, that the reply text lands separately, and that the credit counter moves by 3× the normal amount. Confirm toggling off returns to the normal fast path. Reviews and unit tests cannot catch a z-order or hydration problem here.

- [ ] **Step 11: Commit**

```bash
git add app/composables/useThinkingMode.ts app/composables/useThinkingMode.test.ts app/components/AiDock.vue "app/pages/trips/[id].vue" server/api/ai/usage.get.ts
git commit -m "feat(ui): add the thinking-mode toggle and live reasoning disclosure"
```

---

## Verification

Run before opening a PR:

```bash
bun test server/utils/ server/lib/ app/composables/
bunx nuxi typecheck 2>&1 | tail -5   # error count must match the pre-branch baseline
bunx nuxi build
```

Manual checks:

1. Thinking off → discuss behaves exactly as before; 1 credit for a short turn.
2. Thinking on → "Thinking" disclosure fills, reply follows, 3× credits charged.
3. Unset `DEEPSEEK_API_KEY` locally → the toggle is hidden and a forged `thinking: true` body charges the normal amount.
4. Generate a full itinerary → each day still costs 1 credit.
5. A day whose _next_ day has a different hotel → thinking mode's suggestions drift toward the next base; normal mode is unchanged.

## Known residual risk

Whether DeepSeek thinking mode survives multi-turn tool round-trips is not
determinable from the installed source (`ai-config.ts:31-41` asserts it broke
them; the provider's current reasoning handling suggests it may be fixed).
Task 6 lands the reasoning plumbing before Task 7 enables the mode precisely so
a tool-calling failure surfaces as a visible error rather than silent empty
turns.

**If Task 8's runtime spot-check shows broken tool round-trips:** ship Tasks 1-5
only (day generation uses `generateObject` with no tool loop and is unaffected),
hide the composer toggle by passing `:thinking-available="false"`, and keep the
day-generation toggle. Record the finding and stop — do not try to work around
a broken provider mode.
