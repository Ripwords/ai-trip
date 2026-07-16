# AI Quick Wins — Design

**Date:** 2026-07-16
**Status:** Approved
**Phase:** 2 of 4 (Phase 1 currency correctness shipped; Phase 3 trip-level generation with SSE progress and Phase 4 streaming discuss chat come later, each with their own spec)

## Problem

User priorities for the AI features: itinerary quality, speed/UX, robustness &
cost control. Current state:

1. **Quality ceiling:** every AI call runs on `gemini-3.1-flash-lite` — the
   model registry (`server/lib/ai-config.ts`) supports per-role overrides but
   none are used. The structured-planning calls (which decide venues, times,
   pacing) and the user-facing discuss chat both sit on the cheapest tier.
2. **Latency:** every add/fill/accommodation request runs a fresh web-search
   research pass (`doResearch` in `server/lib/ai.ts`) before generation.
   "Generate full itinerary" on an N-day trip repeats near-identical research
   N times, sequentially.
3. **Fragility:** a `generateObject` schema-validation failure throws straight
   to a 502 ("AI service is temporarily unavailable"); AI-produced
   `suggestedTime` strings are persisted unvalidated (`"9:00"` vs `"09:00"`,
   or garbage); `discuss.post.ts` has a span after `tryConsumeAiCredit`
   (day-validation read, `getTripWithRelations`, FX fetch — lines ~160-204)
   where an infrastructure throw burns a credit with no refund.

## Design

### 1. Model promotion via the existing registry

`server/lib/ai-config.ts` `AI_MODELS` becomes:

```ts
export const AI_MODELS = {
  default: "gemini-3.5-flash", // structured planning (generateObject handlers)
  research: "gemini-3.1-flash-lite", // web-search grounding agent
  classify: "gemini-3.1-flash-lite",
  discuss: "gemini-3.5-flash", // user-facing chat + review judgment
} as const
```

- The six `generateObject` planning calls in `server/lib/ai.ts` already use
  `getModel()` (default) — they get flash with no call-site change.
- `server/lib/discuss-agent.ts:45` and `server/lib/itinerary-review-ai.ts:149`
  switch from `getModel("research")` to `getModel("discuss")`.
- The planner research agent (`server/lib/ai.ts:226`) stays on `research`.
- `server/api/ai/layover-tips.post.ts` stops hardcoding
  `google("gemini-3.1-flash-lite")` and uses `getModel("research")` —
  registry consistency, no behavior change.
- Cost: flash is ~2-4× lite per token; volume is bounded by the existing
  100-prompt/month per-user cap.
- Model id note: the design originally named `gemini-3.1-flash`, which does
  NOT exist — verified against the Generative Language API ListModels
  endpoint on 2026-07-16 (the 3.1 generation only shipped a flash-_lite_
  text tier). `gemini-3.5-flash` is the stable GA flash tier and was
  smoke-tested successfully; the floating `gemini-flash-latest` alias and
  `-preview` ids were rejected for pinning.
- The implementation plan includes a one-off smoke test that calls
  `gemini-3.5-flash` through the project's AI SDK setup (using the dev API
  key) to validate the model id before the registry change lands.

### 2. Research caching

`doResearch(destination, userContext)` in `server/lib/ai.ts` is wrapped in
`defineCachedFunction`:

- **Key:** normalized destination + SHA-256 of the normalized user context
  (context strings are user prompts — hash keeps keys bounded and safe).
- **TTL:** 24h (`maxAge: 60 * 60 * 24`). Venue/restaurant recommendations do
  not move faster than that.
- **Cache the post-sanitization value** (the final safe research block), so a
  cache hit can never re-introduce an unsanitized payload.
- **`validate: (entry) => typeof entry.value === "string" && entry.value.length > 0`**
  — failed or sanitization-dropped research (empty string) is never cached
  (Phase 1 lesson: Nitro caches falsy values by default).

Effect: full-itinerary generation does one research pass instead of N;
repeated edits on the same destination within a day reuse it.

### 3. Robustness

**3a. Retry-once wrapper.** New `server/lib/retry.ts`:

```ts
withOneRetry<T>(label: string, fn: () => Promise<T>): Promise<T>
```

Runs `fn`; on any throw, logs a warning with the label and retries exactly
once; rethrows the second failure. Applied to the six `generateObject`
planning calls in `ai.ts`. (The AI SDK's built-in `maxRetries` covers network
errors only, not schema-validation failures — this wrapper covers both.)

**3b. Output normalization before persistence.** New
`server/lib/normalize-ai-output.ts`:

- `normalizeSuggestedTime(t: string | null | undefined): string | null` —
  accepts `H:MM`/`HH:MM` with hours 0-23 and minutes 0-59, returns
  zero-padded `HH:MM`; anything else returns `null` (the schedule engine
  fills nulls).
- `clampDurationMinutes(d: number | null | undefined): number | null` —
  integers clamped to [5, 720]; non-finite returns `null`.

Applied in two places, split by type shape:

- `updates` and `orderedActivities` are normalized inside `processUserRequest`
  before returning (entries whose time normalizes to `null` are dropped —
  a time-update with a garbage time is useless; durations are clamped).
- `newActivities` are normalized at the two persistence points (day-AI insert
  and `applyProposal`'s `add-activities` insert), alongside the Phase 1 cost
  guard — `AIActivity.suggestedTime` is a required `string` in the in-flight
  type, and only the DB columns are nullable, so `null` can only appear at
  the DB boundary. (Review-judgment proposals are not schema-constrained on
  time format the way discuss propose-tools are, so the applyProposal seam
  matters.)

**3c. Discuss credit-refund gap.** In
`server/api/trips/[id]/discuss.post.ts`, the span between
`tryConsumeAiCredit` and the existing agent-generate try/catch (day-validation
read, `getTripWithRelations`, `getExchangeRate`, context/tool building) is
wrapped so any throw refunds the credit and rethrows. The two
injection-check refund paths inside that span remain as-is (a refund is
idempotent-safe here only if not doubled — the wrap must rethrow AFTER
refunding once, and the injection paths move inside the wrap WITHOUT their
own refund calls, so exactly one refund happens on any failure).

## Testing (TDD, repo pattern: bun test + deps injection)

- **retry.ts:** succeeds first try (fn called once); fails once then succeeds
  (fn called twice, warning logged); fails twice (second error propagates).
- **normalize-ai-output.ts:** `"9:00"` → `"09:00"`, `"09:00"` unchanged,
  `"24:00"`/`"9:99"`/`"noon"`/`""`/`null` → `null`; durations 4 → 5,
  721 → 720, 60 → 60, `NaN`/`null` → `null`.
- **Research cache key:** same destination+context → same key; different
  context → different key; key contains no raw user text (hash only).
- Registry/model changes are config — covered by the smoke test in the plan,
  not unit tests.
- Credit-refund wrap: verified by code review + existing discuss tests
  (endpoint has no test harness; the wrap is a try/catch relocation).

## Out of scope (deliberately)

- Trip-level one-shot generation and SSE progress (Phase 3).
- Streaming discuss chat (Phase 4).
- Deleting the orphaned `/api/exchange-rate` endpoint (separate chore).
- Prompt-content changes to improve suggestion quality (model promotion
  first; re-evaluate prompts after it ships).
