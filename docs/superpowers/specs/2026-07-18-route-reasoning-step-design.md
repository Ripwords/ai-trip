# Dedicated Route-Reasoning Step for LLM Prompts

**Date:** 2026-07-18
**Status:** Approved

## Problem

Generated itineraries can contain geographic backtracking. Real example: on a Da Nang →
Hoi An trip, day 1 was generated as airport → Marble Mountains (south, past the city) →
back north to Da Nang center for dinner and the Dragon Bridge → all the way south again
to the accommodation. The user had to point this out in discuss chat before the AI fixed
it (moving Marble Mountains to the Hoi An travel day, which passes it).

Root cause: no prompt in the pipeline tells the model to reason about route order.
`SCHEDULE_RULES` (server/lib/ai.ts) covers waking hours, meals, durations, and the day
blueprint — nothing about geography. The trip-outline prompt (server/lib/trip-outline.ts)
assigns areas to days without inter-day route guidance. The discuss agent
(server/lib/discuss-agent.ts) is told *what* to propose but never to check route
implications before proposing. The only route-aware call, `handleOptimize`, runs solely
when the user explicitly asks to optimize.

## Solution

Add a dedicated route-reasoning step to both prompt surfaces (generation + discuss), and
force it to actually happen in generation by requiring a `routeReasoning` output field
positioned before the activities in each schema (Approach B: prompt sections + structured
field; chosen over prompt-sections-only, which is skimmable, and over an automatic
post-generation optimize pass, which costs an extra LLM call per day).

### 1. `ROUTE LOGIC` block in `SCHEDULE_RULES` (server/lib/ai.ts)

A dedicated, explicitly-ordered step — before choosing times/order:

- Identify the day's anchors: where the traveler starts (arrival airport, accommodation,
  start location) and where the day ends (accommodation, departure point).
- Plan stops as one continuous path in a consistent direction. Never pass a place and
  double back to it later in the day.
- Cluster geographically nearby stops together.
- A stop that lies on the way between two anchors belongs on the day the traveler
  travels that leg — not on a day that requires a dedicated round trip.

All interpolators of `SCHEDULE_RULES` inherit it: `handleAdd`, `handleFillGaps`,
`handleOptimize`, `handleReschedule`, and the planner agent.

### 2. Required `routeReasoning` field, first in generation schemas (server/lib/ai.ts)

`handleFillGaps`, `handleAdd`, `handleOptimize`, and `handleReschedule` schemas gain
`routeReasoning: z.string()` as the FIRST property, described as: walk the day's route
stop-by-stop from start anchor to end anchor and flag/fix any backtracking before
finalizing the list. First position means the model generates the walk-through before
the activities array. The field is logged for debugging and then discarded — no API
response, DB, or frontend changes.

### 3. Inter-day route guidance in the trip-outline prompt (server/lib/trip-outline.ts)

The outline decides which day each area lands on, so inter-day geography belongs here:

- Sequence day-areas to minimize doubling back across the trip.
- Place en-route sights on the travel day that passes them.
- The outline schema gets the same first-position `routeReasoning` field (trip-level:
  the geographic arc across days), logged and discarded.

### 4. "Before proposing" step in the discuss prompt (server/lib/discuss-agent.ts)

When a propose* call adds, moves, or reorders activities: first walk the affected day's
route start-to-end using the coordinates/addresses already in the trip context
(`getDistance` only when genuinely uncertain), and confirm the change doesn't introduce
backtracking. If the user's own request would create backtracking, say so instead of
silently complying. Text-only — this agent streams prose, no output schema.

## Error handling

Nothing new. `withOneRetry` already wraps every `generateObject` call; a missing
`routeReasoning` is a schema-validation failure the AI SDK retries.

## Testing (TDD)

- Schema tests: `routeReasoning` is required and is the first key in each amended schema
  (fill_gaps, add, optimize, reschedule, outline).
- Prompt tests: the ROUTE LOGIC step is present in `SCHEDULE_RULES`; the outline SYSTEM
  prompt carries the inter-day guidance; `DISCUSS_SYSTEM_PROMPT` carries the
  before-proposing step.
- Normalizer/persistence test: `routeReasoning` never leaks into persisted activities or
  API responses.

## Out of scope

- Automatic post-generation optimize pass (extra LLM call per day; step-metered cost).
- Deterministic geometry checks (haversine-based backtrack detection) — possible later
  layer on `reviewItinerary`.
- Any UI change.
