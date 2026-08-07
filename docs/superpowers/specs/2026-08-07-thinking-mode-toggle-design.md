# Thinking-Mode Toggle — Design

Date: 2026-08-07

## Problem

Two separate problems, addressed together because they share a call path.

**1. The AI's geographic awareness has holes.** Per-day generation
(`server/api/trips/[id]/days/[dayId]/ai.post.ts` → `server/lib/ai.ts`) already
knows where the traveler sleeps tonight, where they woke up, and what flights
they hold. But:

- `ai.post.ts:252` builds `startLocation` as `{name, address}`, discarding the
  `lat`/`lng` it fetched two lines earlier at `:172-173`.
- The `add` and `fill` prompts render only `Staying at: ${name}`
  (`ai.ts:460`, `ai.ts:577`) — the address is dropped too. The model is
  geolocating the accommodation from its name alone. Only `optimize` passes
  real coordinates (`ai.ts:1027`).
- `previousStayDay` (`ai.post.ts:165`) filters `dayNumber < day.dayNumber` —
  strictly backwards. Generation cannot see that the traveler relocates
  tomorrow, so it cannot bias the afternoon toward the transfer or avoid
  stranding them far from the next base.
- `buildFlightsCtx` (`ai.ts:298-318`) emits times only. There is no spatial
  anchor for the return flight — nothing biases the final day toward the
  departure airport, and no marker tells the model which listed flight falls on
  the day being planned.

The discuss agent is better off: `discuss-context.ts:118-132` carries
accommodation forward across multi-night stays and renders every day, so it can
see tomorrow's stay. It shares the missing-coordinates and return-flight gaps.

**2. Some requests deserve more compute than the default.** Complex multi-city
trips, transfer days, and route conflicts need deeper reasoning than a fast
non-thinking pass provides. Users should be able to opt into that per request,
and pay for it.

## Decisions

| Decision             | Choice                                                                |
| -------------------- | --------------------------------------------------------------------- |
| Surfaces             | Both day generation and discuss chat                                  |
| What the toggle buys | Reasoning mode + wider context + larger step budget                   |
| Pricing              | Flat multiplier on whatever the turn would normally cost              |
| Toggle scope         | Per-request in the body; UI remembers via `sessionStorage`            |
| Bug fixes vs. paid   | Geographic correctness is unconditional; cross-day lookahead is gated |

The last row is the load-bearing one: dropped coordinates and an unanchored
return flight are defects, not withheld features. Fixing them behind a paywall
would mean shipping a known-wrong free tier.

## Constraints

- `@ai-sdk/deepseek@3.0.12` exposes `thinking: {adaptive|enabled|disabled}` and
  `reasoningEffort: low|medium|high|xhigh|max`. The current config only ever
  uses `disabled` (`ai-config.ts:39-41`).
- When `DEEPSEEK_API_KEY` is unset, `getModel` falls back to Gemini
  (`ai-config.ts:51-59`). Gemini ignores `deepseek`-namespaced provider options
  entirely.
- No `maxDuration` is configured in `vercel.json`, so the 300s function ceiling
  described in `ai-credit-cost.ts:17-22` is the operative limit.
- `refundAiCredit` is `GREATEST(count - 1, 0)` — it refunds exactly one credit
  and is not idempotent (`ai-limits.ts:119-128`).
- Thinking mode is roughly 8× slower per model call than non-thinking.

## Design

### 1. Model layer

Replace the `AI_PROVIDER_OPTIONS` constant's role at call sites with a function
in `server/lib/ai-config.ts`:

```ts
export function aiProviderOptions(thinking: boolean) {
  return thinking
    ? { deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" } }
    : { deepseek: { thinking: { type: "disabled" } } }
}
```

`AI_PROVIDER_OPTIONS` remains exported as the non-thinking default so unrelated
call sites are untouched. Every `providerOptions:` site in `server/lib/ai.ts`
threads a `thinking: boolean` down from its endpoint.

Export `thinkingAvailable(): boolean` — true only when `DEEPSEEK_API_KEY` is
set. Both endpoints consult it and, when false, downgrade to non-thinking mode
**and** to normal pricing. Without this guard the Gemini fallback would charge
the multiplier for a request that silently never reasoned.

### 2. Context enrichment

**Unconditional (defect fixes, apply in both modes):**

- `ai.post.ts:252` — pass `startLocation.lat` and `startLocation.lng` through
  instead of discarding them.
- `ai.ts:460` and `ai.ts:577` — render the accommodation as
  `name (address) [lat,lng]` for the `add` and `fill` prompts, matching the
  precision `optimize` already gets.
- `buildFlightsCtx` accepts the date of the day being planned, tags the flight
  falling on that day explicitly, and gains a departure-day rule: prefer stops
  on the corridor between the accommodation and the departure airport.

**Gated behind thinking mode (genuine extra tokens):**

- `nextStayDay` — the first day with `dayNumber > day.dayNumber` that has an
  accommodation — passed as `nextLocation` with coordinates. Accompanying
  prompt rule: when tomorrow's base differs from tonight's, keep late-afternoon
  and evening stops on the side of the region that shortens tomorrow's
  transfer, and never schedule something that strands the traveler far from it.
- The full day-by-day trip shape injected into day generation. Today it
  receives only its own day plus a flat name list of other days' activities
  (`ai.post.ts:161-163`).

### 3. Credits

`server/utils/ai-credit-cost.ts` gains:

```ts
export const THINKING_CREDIT_MULTIPLIER = 3
```

- **Discuss:** `settleCredits` bills `creditsForSteps(steps, ceiling) * MULT`.
  `creditsForSteps` currently hard-codes its own cap via
  `Math.min(steps, MAX_DISCUSS_STEPS)` (`ai-credit-cost.ts:33`), which would
  silently bill a 40-step thinking turn as 30. It takes the applicable ceiling
  as a second parameter, defaulting to `MAX_DISCUSS_STEPS` so existing callers
  are unchanged.
- **Day generation:** `tryConsumeAiCredit` first (preserving the existing 429
  gate and its ordering guarantees), then
  `chargeExtraAiCredits(userId, MULT - 1, month)` immediately after. Note the
  argument order — the real signature is `(userId, extra, month)`, extra before
  month (`ai-limits.ts:103-107`).

**Refund correctness.** `refundAiCredit` must take an `amount` parameter, and
`refundOnce` (`ai.post.ts:134-138`) must refund the full amount actually
charged. Without this, every 502 on a thinking-mode generation (`ai.post.ts:263`,
`:435`, `:453`) refunds 1 of 3 credits and keeps the rest. This is a
prerequisite, not a follow-up.

**Step budget and the timeout wall.** `MAX_DISCUSS_STEPS_THINKING = 40`,
**paired with** a wall-clock guard in `prepareStep` (`discuss.post.ts:307`) that
returns `{ activeTools: [] }` once elapsed turn time crosses ~200s, regardless
of step number. Time becomes the primary budget; step count the secondary cap.

The pairing is mandatory. At ~8× per-step latency, 40 steps can exceed 300s. A
timeout kills the process mid-flight, so the catch-block refund never runs and
the user is billed 3× for nothing — precisely the failure `ai-credit-cost.ts:17-22`
was written to prevent. If the clock guard is dropped, the step ceiling must
stay at 30.

### 4. Streaming and UI

- `mapChunk` (`server/lib/discuss-stream.ts:84-105`) currently returns `null`
  for every chunk that is not `tool-call` or `text-delta`, so reasoning deltas
  are silently discarded. Add a `reasoning-delta` case returning
  `{ type: "thinking", delta }`; `discuss.post.ts` pushes it as an SSE
  `thinking` event.
- Reasoning text is **not** persisted and **not** counted toward `streamedAny`
  (`discuss.post.ts:349`). A turn that only reasoned and produced no reply or
  proposal delivered no value and must still refund.
- The client renders a collapsed "Thinking…" disclosure above the reply. This is
  what converts the 8× slowdown from dead air into visible progress, and is the
  reason the mode is usable at all.
- A toggle in the chat composer and on the day-generation panel. Both persist
  to `sessionStorage`, both send `thinking: boolean` in the request body, and
  the server validates it via zod as untrusted input. Both are hidden when
  `thinkingAvailable()` is false. The day-generation control states the credit
  cost inline.

## Error handling

| Failure                                                  | Behaviour                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY` unset                                 | Toggle hidden; requests downgrade to non-thinking at normal price                    |
| Generation throws under thinking mode                    | Full charged amount refunded via the amount-aware `refundOnce`                       |
| Discuss turn produces reasoning but no text or proposals | Refunded — reasoning is not delivered value                                          |
| Turn aborted by client                                   | Metered at the multiplied rate; those steps were really spent                        |
| Wall-clock guard trips                                   | Tools stripped, model spends remaining budget writing a reply; turn settles normally |
| Client sends `thinking: true` while unavailable          | Coerced to false server-side before pricing                                          |

## Testing

- `aiProviderOptions` returns `disabled` for false and `enabled` +
  `reasoningEffort` for true.
- `thinkingAvailable()` false without `DEEPSEEK_API_KEY`; endpoints coerce
  `thinking` to false and charge the unmultiplied amount.
- `creditsForSteps(n, ceiling) * THINKING_CREDIT_MULTIPLIER` for representative
  step counts, including the bracket boundaries at `STEPS_PER_CREDIT`, and a
  40-step turn billing against the thinking ceiling rather than 30.
- `creditsForSteps(n)` with no ceiling argument is unchanged from today.
- `refundAiCredit(userId, month, 3)` restores 3, and `refundOnce` stays
  single-shot under repeated invocation.
- `mapChunk` maps `reasoning-delta` to a `thinking` event and still returns
  `null` for unknown chunk types.
- A turn producing only reasoning deltas refunds and does not persist.
- `startLocation` coordinates reach the `add` and `fill` prompts.
- `buildFlightsCtx` tags the same-day flight and omits the tag otherwise.
- `nextLocation` is present in thinking mode and absent in normal mode.
- The wall-clock guard strips tools past the threshold even when steps remain.

## Residual risk

Whether DeepSeek thinking mode survives multi-turn tool round-trips is not
determinable from the installed source. The `ai-config.ts:31-41` comment
asserts it breaks them; the provider's current reasoning-chunk handling
suggests this may have been addressed since that comment was written.

Mitigation: land the reasoning-chunk plumbing (section 4) before enabling the
toggle, so a tool-calling failure surfaces as a visible error rather than
silent empty turns. The flag defaults off, so nothing regresses for users who
do not opt in. If tool round-trips do prove broken, thinking mode ships for day
generation only — which uses `generateObject` with no tool loop — and the
discuss toggle is withheld.
