# Trip-Level Generation (Outline + Guided Loop) — Design

**Date:** 2026-07-17
**Status:** Approved
**Phase:** 3 of 4 (Phase 1 currency correctness and Phase 2 AI quick wins shipped; Phase 4 streaming discuss chat later)

## Problem

"Generate full itinerary" (`app/composables/useGenerateFullItinerary.ts`) loops
the day-AI endpoint over each empty day with the same generic prompt. Each day
is planned blind to the others:

- No cross-day coherence — no themes, no pacing arc, duplicate-avoidance only
  via the name list of already-persisted days.
- Saved ideas are not deliberately spread across days.
- Flight arrival/departure times are ignored (first/last days get full
  schedules even when the traveler lands at 22:00).
- The loop aborts on the first failed day, stranding the rest.

**Architecture decision (user-approved):** outline + guided loop — one fast
trip-planning AI call, then the existing hardened day-AI endpoint guided by
it. The originally sketched single-request SSE orchestration was rejected:
`vercel.json` has no `maxDuration` override, and a multi-minute streaming
request would exceed default function limits; it would also need a large
persistence-pipeline refactor and has an all-or-nothing failure mode.

## Design

### 1. Trip outline lib — `server/lib/trip-outline.ts`

`buildTripOutline(input, deps?)` makes ONE `generateObject` call
(`getModel()`, wrapped in `withOneRetry("outline", ...)`) that plans all
empty days together.

Input (assembled by the endpoint):

```ts
interface TripOutlineInput {
  destination: string
  startDate: string
  endDate: string
  preferences?: TripPreferences
  tripNotes?: string | null
  savedIdeas: { name: string; type: string; description: string | null }[]
  days: {
    dayId: string
    dayNumber: number
    date: string
    isEmpty: boolean
    existingActivityNames: string[] // non-empty days: for dedup + coherence
  }[]
  flights: {
    departureAirport: string
    arrivalAirport: string
    departureTime: string | null
    arrivalTime: string | null
  }[] // linked trip flights, for pacing (land 22:00 → light first day)
}
```

Output (zod schema; entries ONLY for empty days):

```ts
{
  days: {
    dayNumber: number
    theme: string          // short, e.g. "Old-town temples & street food"
    focusArea: string      // neighborhood/area to concentrate the day in
    mustInclude: string[]  // 0-3 anchors, drawn from saved ideas where they fit
    guidance: string       // one line: pacing/meal/timing guidance for the day
  }[]
  avoidRepeats: string[]   // global venue names no day should duplicate
}
```

Prompt content: destination + dates + day-of-week per day; per-day
empty/non-empty status with existing activity names; preferences, trip notes,
saved ideas via the same context builders the day AI uses
(`formatPreferences`, `buildTripNotesCtx`, `buildSavedIdeasCtx` — exported
from `server/lib/ai.ts`, currently module-private); flights list with times;
instructions: distinct themes per day, geographic clustering per day, spread
saved ideas across matching days, light schedules on arrival/departure days
based on flight times, `avoidRepeats` = every existing activity name plus its
own `mustInclude` picks. No research pass — the outline is places-agnostic
planning; venue grounding happens in the per-day generation as today.

Server-side validation after generation: drop output entries whose
`dayNumber` doesn't match an empty day; cap `mustInclude` at 3 and
`avoidRepeats` at 60 entries.

Deps injection (`deps.generate`) for tests, following the repo pattern.

### 2. Outline endpoint — `POST /api/trips/[id]/generate-outline`

- `requireAuth` + `requireTripAccess(owner|editor)`.
- Load trip, days with activities, saved ideas, and linked flights
  (`getTripFlightsForUser`).
- 400 before any credit spend when the trip has no empty days.
- `tryConsumeAiCredit` (1 credit); any failure after consume refunds exactly
  once and rethrows (same wrap pattern as `discuss.post.ts`).
- Returns `{ outline: { days: [{ dayId, dayNumber, theme, focusArea, mustInclude, guidance }], avoidRepeats } }`
  — `dayId` mapped server-side from `dayNumber` so the client never guesses.
- Nothing is persisted (the outline is transient input to the loop).

### 3. Per-day prompt builder — `app/utils/outline-prompt.ts`

`buildDayPromptFromOutline(entry, avoidRepeats): string` — pure, unit-tested:

> "Plan this day as: {theme}. Concentrate around {focusArea}.
> {guidance} Include if they are real places there: {mustInclude}.
> Do NOT include: {avoidRepeats}."

Hard cap ≤ 1,900 chars (day-AI body limit is 2,000): truncate `avoidRepeats`
first (drop entries, never mid-name), then `mustInclude`. Plain text only —
must survive `sanitizePromptInput` on the server.

### 4. Composable rework — `app/composables/useGenerateFullItinerary.ts`

`run(days, aiRemaining)` becomes:

1. Compute `emptyDays`. Credit plan (pure, unit-tested
   `planGenerationRun(emptyDayCount, aiRemaining)`):
   - `aiRemaining` unknown (undefined) or `>= emptyDays + 1` → outline path,
     generate all empty days. Confirm dialog: "uses N+1 AI prompts (1 to plan
     the trip, 1 per day)".
   - `1 <= aiRemaining < emptyDays + 1` → NO outline (don't burn a scarce
     credit on planning); generic prompts for `min(aiRemaining, emptyDays)`
     days. Existing "generate as many as possible?" confirm, with updated
     copy.
   - `aiRemaining === 0` → existing 429 behavior surfaces from the server.
2. Outline path: call the outline endpoint; on ANY outline failure (429/502/
   sanitize), toast a notice and fall back to generic prompts — generation
   never blocks on the outline.
3. Loop empty days sequentially (order preserved: earlier days persist first,
   so the day-AI's own cross-day dedup sees them). Per day: prompt = outline
   slice via `buildDayPromptFromOutline`, else the existing generic prompt.
   On a 400 from prompt sanitization, retry that day once with the generic
   prompt. On other failures: record and CONTINUE (no more mid-trip aborts).
4. Expose progress: `running`, `currentDayIndex`, `totalDays`,
   `currentDayLabel` ("Day 3 — Old-town temples & street food"), and a final
   `errorMessage` listing failed day numbers.

### 5. Progress UI — `app/pages/trips/[id].vue`

The page currently destructures only `run`. Add a minimal inline progress
indicator (small fixed pill above the AiDock area) shown while `running`:
"Generating Day {n} of {total}: {theme…}" driven by the composable's new
progress state. Failed-days summary lands in the existing toast system. No
AiDock redesign; theme-following surfaces per the dark-mode conventions
(`bg-white` auto-swap).

## Testing (TDD, bun test)

- **trip-outline lib** (injected `deps.generate`): empty-day filtering
  (entries for non-empty/unknown dayNumbers dropped), caps applied
  (mustInclude ≤ 3, avoidRepeats ≤ 60), prompt assembly includes flights,
  existing names, and saved ideas, retry wiring present.
- **outline-prompt builder:** contains theme/focus/guidance/mustInclude;
  ≤ 1,900 chars with 100 long avoid-entries (truncates whole entries);
  omits empty sections cleanly.
- **planGenerationRun:** the three credit branches above, boundary values
  (`aiRemaining = emptyDays`, `= emptyDays + 1`, `= 0`, `undefined`).
- Endpoint: no harness (repo convention) — refund wrap verified by review;
  runtime spot-check in the plan.

## Out of scope (deliberately)

- SSE / server-side orchestration (rejected above).
- Persisting outlines or exposing them in the UI beyond the progress label.
- Parallel day generation (sequential is required for cross-day dedup).
- Changes to `handleFillGaps` or the day-AI endpoint (the prompt carries the
  outline guidance).
- Phase 4 streaming discuss chat.
