# AI Chat Rework — Design

**Date:** 2026-05-20
**Status:** Approved

## Problem

The AI dock today is a one-shot command executor. The user types a prompt → the server classifies an intent (`add`, `remove`, `optimize`, `reschedule`, `fill_gaps`, `accommodation`, `general`) → handlers immediately mutate the itinerary → a toast confirms and offers Undo.

This has three concrete UX problems:

1. **No question-answering.** Users naturally want to ask things like "is 3 days enough in Kyoto?", "is Senso-ji open Tuesday?", "how long from A to B?". The dock can't answer — every prompt is treated as a mutation request.
2. **Review is shallow.** The deterministic `reviewItinerary()` catches structural issues (overlaps, missing meals, late endings) but can't catch judgment issues (pace mismatch with stated preference, backtracking routes, venue closed on the scheduled day-of-week, interest mismatch). Findings also can't be auto-fixed — each one routes to a manual edit modal.
3. **The agent's tools are too thin.** The Mastra `plannerAgent` has exactly one tool — web search. Place lookup, distance matrix, day-state reads, and the deterministic review live outside the agent's reach, so the LLM cannot ground-check anything mid-reasoning. It hallucinates venue names then relies on a separate Google Maps enrichment pass after the fact.

## Goals (this spec)

1. Let the user ask questions about the itinerary and get answers, without changes being made.
2. Make changes safer: every mutation initiated by free-text goes through a **propose → apply** step so the user sees what will happen before it happens.
3. Add **AI judgment review** layered on top of the existing deterministic review, with one-tap fixes on findings where possible.
4. Give the agent real tools (place search, place details, distance matrix, day reads, deterministic review) so its planning is grounded.

## Non-goals

- No chat history / persistence. Every dock session is single-turn and ephemeral.
- No new database tables. Proposals live in the response body and client state only.
- No replacement of the deterministic review tab. It stays as the fast, free, always-available structural check.
- No weather, no events, no flight-delay integration (mentioned only to mark them out of scope).

## High-level design

```
┌───────────────────────────────────────────────────────────────────┐
│  AiDock.vue                                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  input pill (existing)                                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  response panel (replaces suggestion-chip area on submit)   │  │
│  │  - assistant message text                                   │  │
│  │  - proposal cards [Apply] [Dismiss]                         │  │
│  │  - OR findings list (severity-grouped, embedded proposals)  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  quick-action chips (Generate full / Fill gaps / Optimize / │  │
│  │  Review) — direct-execute, unchanged                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        POST /api/trips/[id]/days/[dayId]/ai
        { prompt, mode: "plan" | "execute" }
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
   mode = "plan" (free-text)        mode = "execute" (quick chips)
   returns { message,               returns existing shape, mutates
            proposals[], findings? }
                              │
                              ▼
              user clicks Apply on a proposal
                              │
                              ▼
        POST /api/trips/[id]/proposals/apply
        { proposal: Proposal }
                              │
                              ▼
            applyProposal() → mutates DB →
        returns { message, undoAvailable }
```

## UX flow

The dock UI shape (FAB → bottom sheet → input pill + chips) does not change.

**Submit (free-text):**
1. User types a prompt and hits send.
2. Loading state runs (existing cycler).
3. Server returns `{ message, proposals: Proposal[], findings?: ItineraryReviewFinding[] }`.
4. The dock body switches from suggestion chips to a **response panel**:
   - Short assistant message at the top.
   - Below it: either a list of proposal cards (mutation prompts) or a severity-grouped findings list (review prompts). Both card types render Apply / Dismiss.
5. **Apply** on a card → calls the apply endpoint → on success the card flips to "Applied" with Undo (existing wiring). **Dismiss** removes the card.
6. **Close** on the response panel reverts the dock to suggestion-chip state.

**Quick-action chips:** Generate full / Fill gaps / Optimize / Review keep their current direct-execute behavior — `mode: "execute"`. The user gets a toast and Undo, exactly as today. These are the "I know what I want, do it" shortcuts; the propose-then-apply step would be friction.

**Q&A prompts (new intent `question`):** the server returns `{ message, proposals: [] }`. The response panel shows only the assistant message. No Apply buttons because nothing is being changed.

**Review flow:**
- Free-text prompts matching the existing `isReviewPrompt(prompt)` regex run the AI judgment review and return findings inside the dock response panel.
- The `ItineraryReviewPanel` on the Review tab gains an "Ask AI for fixes" button that opens the dock with the prompt pre-filled. The tab itself continues to call only the deterministic review (zero credit cost) so the always-on view stays free.

**State boundaries:**
- Proposals and findings live only in dock component state.
- Closing the dock, reloading the page, or switching trips drops them.
- Nothing about chat / proposals is persisted to the database.

## Data model

No new tables. No schema migrations.

The only types added are TypeScript types, shared between server and client.

```ts
// server/lib/proposals.ts (new file)
export type Proposal =
  | { id: string; kind: "add-activities"; dayId: string; summary: string;
      payload: { activities: AIActivity[] } }
  | { id: string; kind: "remove-activities"; dayId: string; summary: string;
      payload: { activityIds: string[] } }
  | { id: string; kind: "reschedule"; dayId: string; summary: string;
      payload: { updates: {
        activityId: string;
        suggestedTime: string;
        estimatedDurationMinutes: number;
      }[] } }
  | { id: string; kind: "optimize-route"; dayId: string; summary: string;
      payload: { orderedActivityIds?: string[] } }
  | { id: string; kind: "set-accommodation"; dayId: string; summary: string;
      payload: {
        name: string;
        address: string | null;
        lat: number | null;
        lng: number | null;
        placeId: string | null;
      } }
```

`id` is a client UUID, used as a render key and for Apply-state tracking. `summary` is human-readable, rendered as the card title. `payload` contains everything `applyProposal` needs — Apply is a stateless POST.

`ItineraryReviewFinding` in `server/lib/itinerary-review.ts` gains:

```ts
interface ItineraryReviewFinding {
  // ...existing fields
  proposal?: Proposal
}
```

And the `code` union expands:

```ts
code:
  | <existing codes>
  | "pace-mismatch"
  | "backtracking-route"
  | "closed-on-date"
  | "interest-mismatch"
  | "energy-imbalance"
```

## Server changes

### `POST /api/trips/[id]/days/[dayId]/ai` — reshape

Add a `mode` field to the body schema:

```ts
const aiBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  mode: z.enum(["plan", "execute"]).default("plan"),
})
```

Flow:
1. Auth + access check + credit consume + sanitize — unchanged.
2. If `isReviewPrompt(prompt)`:
   - Call new `reviewItineraryWithJudgment` (see below).
   - Return `{ message, proposals: [], findings, intent: "review" }`.
3. Else run `processUserRequest(...)` — unchanged.
4. If `result.intent === "question"`: return `{ message: result.message, proposals: [], intent: "question" }`. No mutation regardless of `mode`.
5. Otherwise branch on mode:
   - `mode === "execute"` — run the existing post-handler mutation logic, return existing shape.
   - `mode === "plan"` — call new helper `resultToProposals(result, day)` and return `{ message, proposals, intent }`. No mutation. No segment recompute. No activity-log entry (logged at apply time).

### `POST /api/trips/[id]/proposals/apply` — new

```ts
const applyBodySchema = z.object({
  proposal: proposalSchema, // zod schema matching the Proposal union
})
```

Flow:
1. Auth + `requireTripAccess(id, userId, ["owner", "editor"])`.
2. Validate `proposal.dayId` belongs to the trip.
3. Validate `proposal.payload` references (`activityIds` exist on the day, `placeId` resolvable, etc.).
4. Dispatch on `proposal.kind` to `applyProposal(proposal, ...)` which contains the mutation slices currently inline in `ai.post.ts` (insert activities, enrichment, sort/order, segment recompute).
5. Write `activityLog` entry with `action: "ai_proposal_apply"` and the proposal summary.
6. Return `{ message, undoAvailable: true }`.

No AI credit consumed at apply time — credit was already consumed during plan.

### `server/lib/ai.ts` — handler refactor

`processUserRequest` returns `AIProcessResult` (unchanged). New helpers:

- `resultToProposals(result: AIProcessResult, day: DayWithActivities): Proposal[]`
  - Resolves activity name strings to actual `activityId`s using the day record (today's matching logic, deduplicated into one helper).
  - Maps each non-empty slice of the result (`newActivities`, `removals`, `updates`, `orderedActivities`, `accommodation`) into a typed `Proposal`.
  - Returns `[]` if there is nothing actionable.

- `applyProposal(proposal: Proposal, ctx: ApplyContext)`
  - One switch on `proposal.kind`. Each branch mirrors the corresponding block currently in `ai.post.ts`.
  - Reused by both the apply endpoint and `mode: "execute"` on the AI endpoint.

After the refactor, `ai.post.ts` becomes thin: it routes between `mode: "plan"` (plan + return proposals), `mode: "execute"` (plan + apply all proposals + return result), and review (call judgment layer).

### Agent tools

Today's `plannerAgent` has only `webSearchTool`. Add the following tools (Mastra `createTool`, defined in `server/lib/ai-tools.ts`):

| Tool id | Wraps | Input | Output |
|---|---|---|---|
| `search_places` | `searchPlace` in `server/lib/google-maps.ts` | `{ query: string, near?: {lat, lng}, type?: string }` | `{ candidates: Place[] }` |
| `get_place_details` | new — `placeDetails(placeId)` to be added in `google-maps.ts` | `{ placeId: string }` | `{ name, address, openingHours, rating, priceLevel, photos }` |
| `get_distance` | `getDistanceMatrix` | `{ from: {lat, lng}, to: {lat, lng}, mode?: TransportMode }` | `{ durationSeconds, distanceMeters }` |
| `read_day` | `db.query.itineraryDays.findFirst({ with: activities })` | `{ dayId: string }` | day record with activities, accommodation, travel segments |
| `read_trip_summary` | `getTripWithRelations` | `{ tripId: string }` | trimmed view: destination, dates, prefs, per-day activity names + types |
| `run_review` | `reviewItinerary` | `{ scope: "day"|"trip", dayId?: string }` | `ItineraryReviewResult` |

Tools are registered on `plannerAgent`. Tool calls are bounded with `stopWhen: stepCountIs(4)` to cap latency and credit cost (4 picked because: 1 review + 1 read_day + 2 search_places / get_distance covers the heaviest planning loop we expect; revisit if traces show truncation).

`tripId` and `dayId` for the current request are bound into each tool's closure when the agent is invoked, so the model can't query other trips (defense in depth — `requireTripAccess` already enforces this at the endpoint, but the tools should not be wired to query arbitrary trips).

Handlers updated to pass tools to their `generateObject` / `agent.generate` calls:
- `handleAdd` — uses `search_places` to verify candidate venues.
- `handleFillGaps` — uses `search_places` + `read_day` for context.
- `handleReschedule` — uses `get_distance` to validate the new times respect travel buffers.
- `handleOptimize` — uses `get_distance` to ground-truth ordering.
- `handleAccommodation` — uses `search_places` (already does this post-hoc; bring it into the agent loop).
- New `handleQuestion` — uses any of the read tools; returns prose only, no proposals.

### Intent classifier

Add one intent:

```ts
const intentSchema = z.object({
  intent: z.enum([
    "add", "remove", "modify", "optimize",
    "reschedule", "fill_gaps", "accommodation",
    "question",      // ← new
    "general",
  ]),
  reasoning: z.string(),
})
```

`question` is selected for read-only prompts:
- "is 3 days enough in Kyoto?"
- "how long from the hotel to Senso-ji?"
- "is Tsukiji open Tuesday?"
- "should I do TeamLab on Day 2 or Day 4?"
- "tell me about this place"

The classifier prompt is extended with a `question` description and examples. `general` becomes a narrower fallback for truly ambiguous prompts.

## Review layer

`server/lib/itinerary-review.ts` — unchanged behavior; only the type changes (optional `proposal` field, expanded `code` union). The Review tab continues to call it directly via `POST /api/trips/[id]/review`, which is unchanged.

`server/lib/itinerary-review-ai.ts` — new file:

```ts
export async function reviewItineraryWithJudgment(
  trip: ReviewableTrip,
  options: ItineraryReviewOptions,
): Promise<ItineraryReviewResult>
```

Flow:
1. Call `reviewItinerary(trip, options)` to get deterministic findings.
2. Build a context object: deterministic findings + trip preferences + per-day summary (names, times, durations, coords).
3. Invoke `plannerAgent.generate(...)` with the AI tools available and a structured-output schema that returns:
   ```ts
   {
     judgmentFindings: ItineraryReviewFinding[],   // codes from the expanded union
     proposalsForFindings: Array<{ findingId: string; proposal: Proposal }>,
   }
   ```
4. Merge deterministic + judgment findings, dedupe by `dayId + code`. Attach `proposal` to findings by matching `findingId`.
5. Recompute summary counts.

Findings without a clean automatic fix omit `proposal`. The dock and the Review tab both render the Apply button only when `proposal` is present; otherwise they show the existing "Fix" button which routes to the edit-activity modal.

## UI changes

### `app/components/AiDock.vue`

- Add a response panel below the input pill, rendered when the parent passes a `response` prop with shape `{ message?: string; proposals?: Proposal[]; findings?: ItineraryReviewFinding[] }`.
- Response panel mutually exclusive with suggestion chips: when a response is present, chips hide.
- Render proposal cards (proposal kind → icon + title from `summary`). Each card: Apply, Dismiss.
- Render findings list (severity-grouped) when `findings` is present. Each finding card mirrors the layout in `ItineraryReviewPanel.vue` and shows Apply when `finding.proposal` is present.
- New emits: `applyProposal: [proposal: Proposal]`, `dismissProposal: [proposalId: string]`, `closeResponse: []`.

### `app/components/ItineraryReviewPanel.vue`

- Render embedded `finding.proposal` as an Apply button alongside the existing Fix button.
- Add header button "Ask AI for fixes" that emits `requestAiReview` to the parent page, which opens the dock with the prompt pre-filled.

### `app/pages/trips/[id].vue`

- Track dock response state: `aiResponse = ref<{ message; proposals; findings } | null>(null)`.
- `submitAiPrompt` now posts with `mode: "plan"` and sets `aiResponse` from the result instead of mutating immediately and toasting.
- Quick-action handlers (`handleQuickFillGaps`, `handleQuickOptimizeRoute`, `handleGenerateFullItinerary`) post with `mode: "execute"` — keep their existing behavior.
- New handler `handleApplyProposal(proposal)` posts to `/api/trips/[id]/proposals/apply`, then optimistically updates `aiResponse` to mark the proposal as applied, then refreshes trip data.
- New handler `handleDismissProposal(id)` removes the proposal from `aiResponse.proposals` (or `findings[*].proposal`).
- `handleCloseResponse` clears `aiResponse`.
- Pass `aiResponse` into `<AiDock :response="aiResponse" />`.
- Wire `ItineraryReviewPanel`'s `requestAiReview` to open the dock with a pre-filled prompt.

### `app/composables/useAiPromptSuggestions.ts`

Add Q&A suggestions when activities exist:

```ts
const withActivitiesSuggestions = [
  "Is this day too packed?",                // question
  "How long from my hotel to the first stop?", // question
  "Review this day for timing problems",    // review
  "Review the whole trip for issues",       // review
  "Add a coffee shop nearby",               // add
  "Move dinner to 7 PM",                    // reschedule
  "Optimize the route",                     // optimize (quick chip)
  "Fill the gaps",                          // fill (quick chip)
]
```

## Error handling

- Plan endpoint failures: existing 502 behavior + the credit consumed at the top of the handler is refunded (new — add `refundAiCredit(userId)` symmetric to `tryConsumeAiCredit`).
- Apply endpoint failures: return 400 with a message; the proposal card flips back to actionable state on the client.
- Stale proposals (referenced activity deleted, day deleted): apply endpoint returns 409 with a message like "This activity is no longer on the day"; client marks the card as stale and disables Apply.
- Tool failures inside the agent loop: each tool returns `{ error: string }` on failure rather than throwing; the model can decide whether to retry or abandon.

## Testing

- `server/lib/itinerary-review.test.ts` — exists. Add tests for the new optional `proposal` field round-tripping through `formatItineraryReviewMessage` and the new `code` values.
- `server/lib/itinerary-review-ai.test.ts` — new. Tests for the merge/dedupe logic with the agent stubbed.
- `server/lib/proposals.test.ts` — new. Tests `resultToProposals` for each `AIProcessResult` shape and `applyProposal` for each `Proposal.kind`, with the DB stubbed.
- `server/api/trips/[id]/days/[dayId]/ai.post.test.ts` — new (if not already). Test plan vs execute mode return shapes; test that `question` intent returns empty `proposals` and never mutates.
- `server/api/trips/[id]/proposals/apply.post.test.ts` — new. Test access control, stale-proposal 409, success path for each kind.

Follow TDD per project conventions: write each test red before implementing.

## Migration / rollout

No DB migration, no feature flag needed (the changes are additive on the server and the client UI degrades gracefully if the server still mutates — but we ship them together, not behind a flag). The endpoint contract change is backwards compatible because `mode` defaults to `"plan"`; if a stale client posts without `mode`, the response shape changes from "mutated, here's what happened" to "here's the proposal" — that's the intended new behavior.

## Out of scope (future)

- Chat history / multi-turn (explicitly rejected this round).
- Weather, real-time events, flight-delay propagation into review judgment.
- Cross-trip context (the agent only ever sees the current trip).
- Streaming responses in the dock.
- Auto-applied "safe" proposals (e.g., filling a missing time without user confirmation).

## File summary

**New:**
- `server/api/trips/[id]/proposals/apply.post.ts`
- `server/lib/proposals.ts`
- `server/lib/ai-tools.ts`
- `server/lib/itinerary-review-ai.ts`
- Tests listed above.

**Modified:**
- `server/api/trips/[id]/days/[dayId]/ai.post.ts` — add `mode`, split plan/execute, route review prompts to AI judgment layer.
- `server/lib/ai.ts` — register new tools on `plannerAgent`, add `question` intent + `handleQuestion`, thread tools into existing handlers.
- `server/lib/itinerary-review.ts` — add optional `proposal` field, expand `code` union. No logic change.
- `server/lib/google-maps.ts` — add `placeDetails(placeId)`.
- `server/utils/ai-credits.ts` (or wherever `tryConsumeAiCredit` lives) — add `refundAiCredit(userId)` for plan-time failures.
- `app/components/AiDock.vue` — response panel, proposal/finding cards, new emits.
- `app/components/ItineraryReviewPanel.vue` — render embedded proposal Apply button, "Ask AI for fixes" header button.
- `app/pages/trips/[id].vue` — dock response state, `handleApplyProposal`, `handleDismissProposal`, route quick chips to `mode: "execute"`.
- `app/composables/useAiPromptSuggestions.ts` — Q&A suggestions.

**Unchanged:**
- `server/api/trips/[id]/review.post.ts` — deterministic-only, the Review tab keeps calling it.
- All schema files. All other features.
