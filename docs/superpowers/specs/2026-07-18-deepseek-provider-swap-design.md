# DeepSeek Provider Swap for Non-Grounded LLM Calls

**Date:** 2026-07-18
**Status:** Approved

## Problem

All heavy LLM traffic runs on Gemini 3.5 Flash ($1.50/M input, $9.00/M output): the six
itinerary handlers, the trip outline, the itinerary review, and the discuss chat. DeepSeek
V4 Flash costs $0.14/M input (cache-miss) and $0.28/M output — roughly 10× cheaper on
input and 30× on output — and the AI SDK has an official `@ai-sdk/deepseek` provider with
`generateObject` and tool-calling support. The user is incurring real Gemini API costs.

## What is Gemini-locked (stays)

Only calls that attach `google.tools.googleSearch` grounding to the model — a
Gemini-only feature:

- `webSearchTool` in `server/lib/ai.ts` (planner research; nested `gp("gemini-3.1-flash-lite")` call)
- discuss `webSearch` tool in `server/lib/ai-tools.ts` (nested Gemini call inside the tool —
  works unchanged regardless of which model drives the outer agent)
- `server/lib/visa-checker.ts` (direct `google(...)` + grounding)
- `server/api/ai/layover-tips.post.ts` — uses `getModel("research")` AND attaches grounding
  to it, so the `research` registry key MUST remain a Gemini model.

Google Places / Maps / Distance Matrix are server-side REST (`google-maps.ts`) — not
LLM-provider-coupled at all.

## What swaps to DeepSeek

The `default` and `discuss` registry keys move to `deepseek-v4-flash`
(`deepseek-chat` is deprecated 2026-07-24 — go straight to V4):

- `default`: trip outline (`trip-outline.ts`), `handleAdd`, `handleRemove`,
  `handleFillGaps`, `handleOptimize`, `handleReschedule`, `handleAccommodation` (`ai.ts`)
- `discuss`: discuss agent (`discuss-agent.ts`), itinerary review (`itinerary-review-ai.ts`)

`research` and `classify` stay on `gemini-3.1-flash-lite` (grounding constraint above;
already cheap).

## Design

### Registry refactor (`server/lib/ai-config.ts`)

Entries become `{ provider: "google" | "deepseek", model: string }`:

```
default:  { provider: "deepseek", model: "deepseek-v4-flash" }
research: { provider: "google",   model: "gemini-3.1-flash-lite" }
classify: { provider: "google",   model: "gemini-3.1-flash-lite" }
discuss:  { provider: "deepseek", model: "deepseek-v4-flash" }
```

`getModel(key)` resolves through `@ai-sdk/deepseek` or `@ai-sdk/google`. Public signature
unchanged — no call-site edits anywhere.

### Safety fallback

If `process.env.DEEPSEEK_API_KEY` is unset, `getModel` falls back to the current Gemini
model for that key (`gemini-3.5-flash` for default/discuss) and logs a one-line warning
once. Deploys can never break on a missing key; rollback of any surface is a one-line
registry change.

### Known risk, accepted

DeepSeek V4 has a confirmed intermittent issue emitting tool calls as plain text instead
of structured `tool_calls` (deepseek-ai/DeepSeek-V3#1244, non-deterministic, rare):

- Batch `generateObject` calls: harmless — schema validation fails and `withOneRetry`
  re-runs.
- Discuss chat: could occasionally surface as raw JSON text in a streamed reply. Accepted
  by the user for max savings; the fallback lever above makes reverting `discuss` to
  Gemini a one-line change if it shows up in practice.

## Dependencies

- New package: `@ai-sdk/deepseek` (bun add).
- New env var: `DEEPSEEK_API_KEY` (local `.env` + Vercel project settings — the user sets
  the Vercel one; never write to production infra directly).

## Testing (TDD)

- `getModel("research")` / `getModel("classify")` return Gemini model instances
  (grounding-locked keys never swap) — assert on the resolved model's `modelId`/provider.
- `getModel()` / `getModel("discuss")` return DeepSeek model instances when
  `DEEPSEEK_API_KEY` is set.
- Fallback: with `DEEPSEEK_API_KEY` unset, `getModel()` returns the Gemini fallback model.
- Existing suites (`ai.test.ts`, `trip-outline.test.ts`, `discuss-agent.test.ts`) keep
  passing — proves no call-site signature drift.

## Out of scope

- Swapping `research`/`classify` (grounding constraint / negligible savings).
- Prompt-content changes (covered by the route-reasoning spec).
- Any runtime prompt-caching or cost-dashboard work.
