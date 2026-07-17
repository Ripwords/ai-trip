# Discuss chat: drop day-scope label, shimmer the action lines, teach route-awareness

**Date:** 2026-07-17
**Status:** Approved (design)

## Context

The "discuss" planner chat (`AiDock.vue`, streamed over SSE from
`server/api/trips/[id]/discuss.post.ts`) lets the AI edit a trip itinerary. Three
independent improvements, all scoped to existing files — no DB, SSE, or tool-contract
changes.

## Change 1 — Remove the "Editing Day N" header subtitle

**Why.** The header shows `Editing {{ activeDayLabel }}` (`AiDock.vue:366`). Edits
still default to the open day, but the model now resolves scope itself (multi-day and
whole-trip requests included), so pinning a single day in the header is misleading the
moment a request spans days.

**What.**
- Delete the subtitle `<span>` in `AiDock.vue`; header keeps only "FROM YOUR PLANNER".
- Remove the now-unused `activeDayLabel` prop from `AiDock` and the
  `:active-day-label` binding + `activeDayLabel` computed in `trips/[id].vue`
  (confirm no other consumer first).

**Behavior unchanged.** The open-day default is carried by the request `dayId`
(→ ` · OPEN` context marker + tool default target in `createDiscussTools`), not by
this label. Purely cosmetic removal.

## Change 2 — Shimmer the streaming action lines

**Why.** The tool-progress lines (`.dock-tool-line`, populated from
`msg.toolCallSummary` as SSE `tool` events arrive) are static gray italic text. A
subtle animation makes the "AI is working" moment feel alive, matching the component's
existing motion vocabulary (`dotPulse`, `fab-pop`, `sheet-up`, `BorderBeam`).

**What (frontend only, `AiDock.vue`).**
- Each new line **fades + slides in** on arrival (CSS keyframe via keyed `v-for` /
  `TransitionGroup`).
- Within the **currently-streaming** message, only the **last** line (the in-flight
  tool) shows a **gradient text-shimmer** — animated `background-position` over a
  `background-clip: text` gradient. Earlier lines are already settled to static gray.
- On stream completion all lines settle to the plain gray style.
- Extend the existing `prefers-reduced-motion` block so it degrades to static text.

**Signal.** Requires a per-message "is streaming" indicator inside `AiDock`. Confirm
the existing streaming state during implementation and thread it to the tool-line loop
if not already available. No SSE/backend change.

## Change 3 — Route-awareness in the discuss system prompt

**Why.** `DISCUSS_SYSTEM_PROMPT` (`server/lib/discuss-agent.ts`) gives almost no
guidance on geographic ordering. The equivalent guidance already exists in the
reviewer prompt (`itinerary-review-ai.ts:167`, the `backtracking-route` finding). The
model should always weigh route geography — as in the user's Marble Mountains example,
where doubling back to the airport was needless backtracking.

**What (prompt text only).** Add a "Route & geography" section:
- Always factor geographic flow into adds / reorders / reschedules — cluster nearby
  stops, keep a coherent path, avoid backtracking / zig-zag / needless doubling back.
- **Proactively** flag obvious backtracking in the open day even when unasked — one
  short observation, consistent with the existing terse voice.
- Use own geographic knowledge first; spend a `getDistance` step **only** when a
  specific proposed reorder/insertion genuinely hinges on travel time — respect the
  step/credit budget the prompt already emphasizes.
- No new tools, no schema changes.

## Testing & verification

- **Change 3:** if the repo has a test asserting on `DISCUSS_SYSTEM_PROMPT`, follow
  TDD — add/adjust an assertion for the new guidance first. If the prompt is only a
  bare constant with no test seam, skip a low-value snapshot test.
- **Changes 1–2:** visual/behavioral — verify by running `nuxt build` (catches Vue
  template compile errors) and driving the discuss chat in a browser (header renders
  without the subtitle; lines fade in and the active line shimmers, then settle).

## Out of scope

DB schema, SSE frame shape, tool contracts, the deterministic reviewer, the separate
"Generate full itinerary" feature.
