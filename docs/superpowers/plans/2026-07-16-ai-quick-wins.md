# AI Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise AI itinerary quality (model promotion), cut per-request latency (research caching), and harden the AI paths (retry, output normalization, credit-refund gap) — Phase 2 of the AI/currency improvement effort.

**Architecture:** All changes ride existing seams: the model registry in `ai-config.ts` gains explicit roles; `doResearch` gets a `defineCachedFunction` wrapper with a never-cache-failures validator (Phase 1 lesson); two new tiny libs (`retry.ts`, `normalize-ai-output.ts`) are wired into the six planning `generateObject` calls and the two AI persistence points; `discuss.post.ts` closes its consume-without-refund span.

**Tech Stack:** Nuxt/Nitro, AI SDK + Mastra (Gemini), Zod, `bun test` (node:test style, preload shims in `server/test-setup.ts`).

**Spec:** `docs/superpowers/specs/2026-07-16-ai-quick-wins-design.md`

## Global Constraints

- TypeScript: never use `any`; `as unknown as X` only when strictly necessary.
- Conventional Commits; TDD (failing test first for every new module).
- Tests run with `bun test <path>`; bunfig preload shims `defineCachedFunction` (identity), `createError`, `$fetch`.
- Server files import `shared/` via relative paths, never `#shared`.
- Before declaring done: `bun test` (all) and `bun run check` must pass. `bun run build` fails at a known pre-existing better-auth ENAMETOOLONG trace step (identical on master) — the Vue/Nitro compile phases must succeed; the trace failure is accepted.
- Quote bracketed paths in shell commands (e.g. `"server/api/trips/[id]/discuss.post.ts"`).

---

### Task 1: Retry-once wrapper

**Files:**
- Create: `server/lib/retry.ts`
- Create: `server/lib/retry.test.ts`

**Interfaces:**
- Produces: `withOneRetry<T>(label: string, fn: () => Promise<T>): Promise<T>` — Task 3 wraps the six `generateObject` calls with it.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/retry.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { withOneRetry } = await import("./retry")

describe("withOneRetry", () => {
  it("returns the first result and calls fn once on success", async () => {
    let calls = 0
    const result = await withOneRetry("test", async () => {
      calls++
      return 42
    })
    assert.equal(result, 42)
    assert.equal(calls, 1)
  })

  it("retries once after a failure and returns the second result", async () => {
    let calls = 0
    const result = await withOneRetry("test", async () => {
      calls++
      if (calls === 1) throw new Error("schema validation failed")
      return "ok"
    })
    assert.equal(result, "ok")
    assert.equal(calls, 2)
  })

  it("rethrows the second failure and does not call fn a third time", async () => {
    let calls = 0
    await assert.rejects(
      withOneRetry("test", async () => {
        calls++
        throw new Error(`failure ${calls}`)
      }),
      /failure 2/,
    )
    assert.equal(calls, 2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/retry.test.ts`
Expected: FAIL — `Cannot find module './retry'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/retry.ts
/**
 * Run `fn`; on any throw, log and retry exactly once; rethrow the second
 * failure. Covers generateObject schema-validation failures, which the AI
 * SDK's built-in maxRetries (network errors only) does not.
 */
export async function withOneRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[retry] ${label} failed, retrying once:`, e)
    return await fn()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/retry.test.ts`
Expected: PASS (3 tests; the retry test's console.warn in output is the wrapper working, not noise)

- [ ] **Step 5: Commit**

```bash
git add server/lib/retry.ts server/lib/retry.test.ts
git commit -m "feat(ai): retry-once wrapper for structured generation calls"
```

---

### Task 2: AI output normalization helpers

**Files:**
- Create: `server/lib/normalize-ai-output.ts`
- Create: `server/lib/normalize-ai-output.test.ts`

**Interfaces:**
- Produces: `normalizeSuggestedTime(t: string | null | undefined): string | null` and `clampDurationMinutes(d: number | null | undefined): number | null` — Task 3 wires them.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/normalize-ai-output.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { normalizeSuggestedTime, clampDurationMinutes } = await import("./normalize-ai-output")

describe("normalizeSuggestedTime", () => {
  it("zero-pads single-digit hours", () => {
    assert.equal(normalizeSuggestedTime("9:00"), "09:00")
  })

  it("keeps valid HH:MM unchanged", () => {
    assert.equal(normalizeSuggestedTime("09:00"), "09:00")
    assert.equal(normalizeSuggestedTime("23:59"), "23:59")
    assert.equal(normalizeSuggestedTime("00:00"), "00:00")
  })

  it("returns null for out-of-range or garbage values", () => {
    assert.equal(normalizeSuggestedTime("24:00"), null)
    assert.equal(normalizeSuggestedTime("9:99"), null)
    assert.equal(normalizeSuggestedTime("noon"), null)
    assert.equal(normalizeSuggestedTime(""), null)
    assert.equal(normalizeSuggestedTime(null), null)
    assert.equal(normalizeSuggestedTime(undefined), null)
  })
})

describe("clampDurationMinutes", () => {
  it("clamps into [5, 720]", () => {
    assert.equal(clampDurationMinutes(4), 5)
    assert.equal(clampDurationMinutes(721), 720)
    assert.equal(clampDurationMinutes(60), 60)
    assert.equal(clampDurationMinutes(5), 5)
    assert.equal(clampDurationMinutes(720), 720)
  })

  it("returns null for non-finite or missing values", () => {
    assert.equal(clampDurationMinutes(Number.NaN), null)
    assert.equal(clampDurationMinutes(null), null)
    assert.equal(clampDurationMinutes(undefined), null)
  })

  it("rounds fractional minutes", () => {
    assert.equal(clampDurationMinutes(90.6), 91)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/normalize-ai-output.test.ts`
Expected: FAIL — `Cannot find module './normalize-ai-output'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/normalize-ai-output.ts
/**
 * Normalize an AI-produced start time to strict zero-padded HH:MM.
 * Returns null for anything unparseable or out of range — the schedule
 * engine treats null as "fill this in".
 */
export function normalizeSuggestedTime(t: string | null | undefined): string | null {
  if (!t) return null
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hours = parseInt(m[1]!, 10)
  const minutes = parseInt(m[2]!, 10)
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

/** Clamp an AI-produced venue duration to a sane range (5 min – 12 h). */
export function clampDurationMinutes(d: number | null | undefined): number | null {
  if (d == null || !Number.isFinite(d)) return null
  return Math.min(720, Math.max(5, Math.round(d)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/normalize-ai-output.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/lib/normalize-ai-output.ts server/lib/normalize-ai-output.test.ts
git commit -m "feat(ai): normalize AI-produced times and durations"
```

---

### Task 3: Wire retry + normalization into the AI paths

**Files:**
- Modify: `server/lib/ai.ts` (six `generateObject` call sites; end of `processUserRequest`)
- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts` (insert values)
- Modify: `server/lib/proposals.ts` (`add-activities` insert values)

**Interfaces:**
- Consumes: `withOneRetry` (Task 1), `normalizeSuggestedTime`/`clampDurationMinutes` (Task 2).
- Produces: no new exports; `processUserRequest` return shape is unchanged (entries may be dropped/normalized).

- [ ] **Step 1: Wrap the six generateObject calls in `server/lib/ai.ts`**

Add import at the top:

```typescript
import { withOneRetry } from "./retry"
```

There are exactly six `const { object } = await generateObject({ ... })` calls (in `handleAdd`, `handleRemove`, `handleFillGaps`, `handleOptimize`, `handleReschedule`, `handleAccommodation`). Change each from:

```typescript
  const { object } = await generateObject({
    ...
  })
```

to (label = the handler's intent name: `"add"`, `"remove"`, `"fill_gaps"`, `"optimize"`, `"reschedule"`, `"accommodation"`):

```typescript
  const { object } = await withOneRetry("add", () =>
    generateObject({
      ...
    }),
  )
```

The `generateObject` options object is unchanged in every case — only the wrapping changes.

- [ ] **Step 2: Normalize `updates` and `orderedActivities` in `processUserRequest`**

In `server/lib/ai.ts`, add import:

```typescript
import { normalizeSuggestedTime, clampDurationMinutes } from "./normalize-ai-output"
```

In `processUserRequest`, immediately before the final `logger.info("=== DONE ===", ...)` block, add:

```typescript
  // Normalize AI-produced times/durations before they reach any DB write.
  // Entries whose time can't be parsed are dropped — a time-update with a
  // garbage time is useless. Durations are clamped to [5, 720] minutes.
  result.updates = result.updates.flatMap((u) => {
    const time = normalizeSuggestedTime(u.suggestedTime)
    if (!time) return []
    return [
      {
        ...u,
        suggestedTime: time,
        estimatedDurationMinutes:
          clampDurationMinutes(u.estimatedDurationMinutes) ?? u.estimatedDurationMinutes,
      },
    ]
  })
  if (result.orderedActivities) {
    result.orderedActivities = result.orderedActivities.flatMap((o) => {
      const time = normalizeSuggestedTime(o.suggestedTime)
      return time ? [{ ...o, suggestedTime: time }] : []
    })
  }
```

- [ ] **Step 3: Normalize new activities at the day-AI insert**

In `server/api/trips/[id]/days/[dayId]/ai.post.ts`, add to the existing lib imports:

```typescript
import {
  normalizeSuggestedTime,
  clampDurationMinutes,
} from "../../../../../lib/normalize-ai-output"
```

In the `db.insert(activities).values(` mapping (the one that already uses `guardedCosts[index]`), change:

```typescript
              suggestedTime: activity.suggestedTime,
              estimatedDurationMinutes: activity.estimatedDurationMinutes,
```

to:

```typescript
              suggestedTime: normalizeSuggestedTime(activity.suggestedTime),
              estimatedDurationMinutes:
                clampDurationMinutes(activity.estimatedDurationMinutes) ??
                activity.estimatedDurationMinutes,
```

- [ ] **Step 4: Normalize new activities at the proposal-apply insert**

In `server/lib/proposals.ts`, add import:

```typescript
import { normalizeSuggestedTime, clampDurationMinutes } from "./normalize-ai-output"
```

In the `case "add-activities":` insert mapping (the one that already uses `guardedCosts[i]`), change:

```typescript
                suggestedTime: a.suggestedTime,
                estimatedDurationMinutes: a.estimatedDurationMinutes,
```

to:

```typescript
                suggestedTime: normalizeSuggestedTime(a.suggestedTime),
                estimatedDurationMinutes:
                  clampDurationMinutes(a.estimatedDurationMinutes) ?? a.estimatedDurationMinutes,
```

(Note: `slotNewActivitiesIntoSequence` receives the inserted rows' `suggestedTime` from `.returning(...)`, so it sees the normalized values — no further change needed.)

- [ ] **Step 5: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean

- [ ] **Step 6: Commit**

```bash
git add server/lib/ai.ts server/lib/proposals.ts "server/api/trips/[id]/days/[dayId]/ai.post.ts"
git commit -m "fix(ai): retry structured generation once and normalize times/durations before persistence"
```

---

### Task 4: Research caching

**Files:**
- Create: `server/lib/ai-cache.ts`
- Create: `server/lib/ai-cache.test.ts`
- Modify: `server/lib/ai.ts` (`doResearch`)

**Interfaces:**
- Produces: `researchCacheKey(destination: string, userContext?: string): string` and `isCacheableResearch(value: unknown): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/ai-cache.test.ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { researchCacheKey, isCacheableResearch } = await import("./ai-cache")

describe("researchCacheKey", () => {
  it("is stable for the same destination and context", () => {
    assert.equal(
      researchCacheKey("Tokyo, Japan", "ramen spots"),
      researchCacheKey("Tokyo, Japan", "ramen spots"),
    )
  })

  it("normalizes case and whitespace", () => {
    assert.equal(
      researchCacheKey("  Tokyo, Japan ", "Ramen Spots"),
      researchCacheKey("tokyo, japan", "ramen spots"),
    )
  })

  it("differs when the context differs", () => {
    assert.notEqual(
      researchCacheKey("Tokyo, Japan", "ramen spots"),
      researchCacheKey("Tokyo, Japan", "jazz bars"),
    )
  })

  it("contains no raw user text and only storage-safe characters", () => {
    const key = researchCacheKey("Tokyo, Japan", "IGNORE ALL <instructions>://?")
    assert.ok(!/ignore all/i.test(key))
    assert.match(key, /^[a-z0-9-]+$/)
  })
})

describe("isCacheableResearch", () => {
  it("accepts a non-empty research block", () => {
    assert.equal(isCacheableResearch("<research_results>…</research_results>"), true)
  })

  it("rejects empty results and non-strings (never cache failures)", () => {
    assert.equal(isCacheableResearch(""), false)
    assert.equal(isCacheableResearch(null), false)
    assert.equal(isCacheableResearch(undefined), false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/ai-cache.test.ts`
Expected: FAIL — `Cannot find module './ai-cache'`

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/ai-cache.ts
import { createHash } from "node:crypto"

/**
 * Cache key for the web-research pass: a readable destination slug plus a
 * short hash of destination+context. User text never appears raw in the key
 * (context strings are user prompts), and the result is storage-safe.
 */
export function researchCacheKey(destination: string, userContext?: string): string {
  const dest = destination.toLowerCase().trim()
  const ctx = (userContext ?? "").toLowerCase().trim()
  const slug = dest.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
  const hash = createHash("sha256").update(`${dest}::${ctx}`).digest("hex").slice(0, 16)
  return `${slug}-${hash}`
}

/** Never cache failed or sanitization-dropped research (empty string). */
export function isCacheableResearch(value: unknown): boolean {
  return typeof value === "string" && value.length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/ai-cache.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Wrap `doResearch` in `server/lib/ai.ts`**

Add import:

```typescript
import { researchCacheKey, isCacheableResearch } from "./ai-cache"
```

Replace the existing `async function doResearch(destination: string, userContext?: string): Promise<string> { ... }` declaration with a cached function of the same name and call signature (the body between the braces is UNCHANGED — copy it verbatim):

```typescript
// Cached: the research pass is the slowest step of every add/fill/accommodation
// request, and full-itinerary generation repeats near-identical research per
// day. 24h TTL; failures (empty string) are never cached so a transient web
// failure can't stick (see Phase 1 FX-cache lesson).
const doResearch = defineCachedFunction(
  async (destination: string, userContext?: string): Promise<string> => {
    // ...existing body, unchanged...
  },
  {
    maxAge: 60 * 60 * 24,
    name: "aiResearch",
    group: "ai",
    getKey: (destination: string, userContext?: string) =>
      researchCacheKey(destination, userContext),
    validate: (entry) => isCacheableResearch(entry.value),
  },
)
```

If TypeScript complains about the `entry` parameter type, type it structurally as `{ value: string }` — do NOT use `any`.

- [ ] **Step 6: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean (in tests the preload shims `defineCachedFunction` to identity, so `doResearch` behaves exactly as before)

- [ ] **Step 7: Commit**

```bash
git add server/lib/ai-cache.ts server/lib/ai-cache.test.ts server/lib/ai.ts
git commit -m "feat(ai): cache the web-research pass per destination+context for 24h"
```

---

### Task 5: Model registry promotion

**Files:**
- Modify: `server/lib/ai-config.ts`
- Modify: `server/lib/discuss-agent.ts` (model line)
- Modify: `server/lib/itinerary-review-ai.ts` (model line)
- Modify: `server/api/ai/layover-tips.post.ts` (model line + import)

**Interfaces:**
- Produces: `AI_MODELS` gains a `discuss` key; `getModel("discuss")` becomes valid. No other signature changes.

- [ ] **Step 1: Smoke-test the model id against the real API**

The registry change is pointless if `gemini-3.1-flash` isn't a valid model id. Write this throwaway script to the session scratchpad directory (NOT the repo) as `smoke-flash.ts`:

```typescript
import { generateText } from "ai"
import { google } from "@ai-sdk/google"

const { text } = await generateText({
  model: google("gemini-3.1-flash"),
  prompt: "Reply with exactly: ok",
})
console.log("MODEL OK:", JSON.stringify(text.trim()))
```

Run from the repo root (the key lives in `.env` as `GOOGLE_GENERATIVE_AI_API_KEY`):

```bash
set -a && source .env && set +a && bun /path/to/scratchpad/smoke-flash.ts
```

Expected: `MODEL OK: "ok"` (any short reply is fine — the point is no model-not-found error).
If the model id is rejected, STOP and report BLOCKED with the API error — do not guess at alternative ids.

- [ ] **Step 2: Update the registry**

Replace the `AI_MODELS` const in `server/lib/ai-config.ts` with:

```typescript
/**
 * Model registry — swap models per handler without touching business logic.
 * `default` (structured planning) and `discuss` (user-facing chat + review
 * judgment) run on flash for quality; research/classification stay on
 * flash-lite for cost.
 */
export const AI_MODELS = {
  default: "gemini-3.1-flash",
  research: "gemini-3.1-flash-lite",
  classify: "gemini-3.1-flash-lite",
  discuss: "gemini-3.1-flash",
} as const
```

- [ ] **Step 3: Switch the two agents to the discuss key**

In `server/lib/discuss-agent.ts`, change `model: getModel("research"),` to `model: getModel("discuss"),`.

In `server/lib/itinerary-review-ai.ts`, change `model: getModel("research"),` (inside the `reviewAgent` definition) to `model: getModel("discuss"),`.

The planner research agent in `server/lib/ai.ts` (`model: getModel("research")`) stays as-is.

- [ ] **Step 4: Route layover tips through the registry**

In `server/api/ai/layover-tips.post.ts`:

1. Add import: `import { getModel } from "../../lib/ai-config"`
2. Change `const model = google("gemini-3.1-flash-lite")` to `const model = getModel("research")`
3. The `google` import is still used by `google.tools.googleSearch(...)` on the next lines — keep it.

- [ ] **Step 5: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean

- [ ] **Step 6: Commit**

```bash
git add server/lib/ai-config.ts server/lib/discuss-agent.ts server/lib/itinerary-review-ai.ts server/api/ai/layover-tips.post.ts
git commit -m "feat(ai): promote planning and discuss models to gemini-3.1-flash"
```

---

### Task 6: Close the discuss credit-refund gap

**Files:**
- Modify: `server/api/trips/[id]/discuss.post.ts`

**Interfaces:**
- Consumes: existing `refundAiCredit` (already imported in the file). No new exports.

- [ ] **Step 1: Wrap the post-consume span**

In `server/api/trips/[id]/discuss.post.ts`, the current shape after `await tryConsumeAiCredit(session.user.id)` is:

1. injection check → `refundAiCredit` + throw 400
2. sanitize/normalize → empty-content check → `refundAiCredit` + throw 400
3. `normalizeTransportMode`
4. dayId validation read (`db.query.itineraryDays.findFirst`)
5. `getTripWithRelations(id)` + context building
6. `getExchangeRate` + `createDiscussTools`
7. the agent `generate` call inside its own try/catch (which refunds and returns a friendly message)

Steps 3–6 currently have NO refund on throw — a DB/infra error there burns the credit. Restructure so exactly one refund happens on any failure path:

- Remove the two inline `await refundAiCredit(session.user.id)` calls from the injection and empty-content checks (keep their `throw createError(...)` statements).
- Wrap everything from the injection check down to (and including) the `createDiscussTools` call in:

```typescript
  let tools: ReturnType<typeof createDiscussTools>
  let cleanMessages: { role: "user" | "assistant"; content: string }[]
  // …plus the other locals the later code needs (proposalCollector, toolCalls)
  // declared before the try so they stay in scope after it.
  try {
    // injection check (throws 400, no inline refund)
    // sanitize + empty-content check (throws 400, no inline refund)
    // transportMode, dayId validation, getTripWithRelations, context injection,
    // getExchangeRate, createDiscussTools — all unchanged, just moved inside
  } catch (e) {
    // Anything that throws after the credit was consumed and before the agent
    // ran refunds exactly once. The agent call below has its own try/catch.
    await refundAiCredit(session.user.id)
    throw e
  }
```

Concretely: declare the locals that outlive the block (`cleanMessages`, `dayId`, `transportMode`, `days`, `proposalCollector`, `toolCalls`, `tools`) before the `try`, assign them inside it, and keep the existing agent-generate try/catch (with its refund + friendly-message return) after the block, unchanged. Preserve all existing logic and comments — this is a control-flow relocation, not a rewrite. Update the comment above `tryConsumeAiCredit` (which currently claims "every throw below this point ... refunds correctly") to say the refund is handled by the wrap below.

If exact typing of the declared locals gets awkward, derive types from existing values (`typeof`/`ReturnType`) — do NOT use `any`.

- [ ] **Step 2: Verify nothing broke**

Run: `bun test && bun run check`
Expected: all tests PASS, lint/format clean. (`discuss-agent.test.ts` covers the system prompt, not this handler; there is no endpoint harness — correctness is by review, and the change is a try/catch relocation.)

- [ ] **Step 3: Commit**

```bash
git add "server/api/trips/[id]/discuss.post.ts"
git commit -m "fix(ai): refund the AI credit when discuss setup fails after consume"
```

---

### Task 7: Full verification

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: PASS, zero failures (existing suites + 3 new test files)

- [ ] **Step 2: Lint and format**

Run: `bun run check`
Expected: clean, no new warnings beyond the repo's pre-existing ones

- [ ] **Step 3: Production build**

Run: `bun run build`
Expected: Vue client/server bundles and the Nitro server build succeed; the run then fails at the known pre-existing better-auth ENAMETOOLONG trace step (accepted — identical on master; Vercel unaffected).

- [ ] **Step 4: Runtime spot-check (if local dev environment available)**

With the local docker DB and a dev session: ask the day AI to add one activity; confirm the response is normal, the stored `suggestedTime` is strict `HH:MM`, and a second AI request for the same destination is visibly faster (research cache hit — check the dev log for a missing `[research] Searching for` line on the second call).

- [ ] **Step 5: Confirm clean tree**

```bash
git status
```

Expected: clean; every task committed separately.
