# Streaming Discuss Chat — Design

**Date:** 2026-07-17
**Status:** Approved
**Phase:** 4 of 4 (Phase 1 currency correctness, Phase 2 AI quick wins, and Phase 3
trip-level generation shipped)

## Problem

`POST /api/trips/[id]/discuss` runs a Mastra agent with `maxSteps: 10` and
returns one JSON blob only after the whole tool-calling loop finishes — web
searches, Places lookups, distance checks included. The user watches an
animated-dots placeholder ("Thinking...") for the entire turn with no signal
of what is happening.

The endpoint already builds a `toolCallSummary` ("searched Google Maps for
'ramen Shinjuku'", "checked travel time between two stops") and `AiDock.vue`
already renders it — but only *retrospectively*, attached to the finished
message. The words describing the work exist; they just arrive after the work
is over.

Two further defects, adjacent enough to fix here (both concern AI-credit
correctness, which this work touches directly):

- `processUserRequest` (`server/lib/ai.ts:857-860`) catches every handler
  error, logs `=== HANDLER FAILED ===`, sets
  `result.message = "Something went wrong processing your request."` and
  **returns normally** with empty arrays. So `ai.post.ts`'s catch never fires:
  no 502, no refund. The user is charged, sees a 200, and the page reports
  success over an empty day. This also silently undercuts Phase 3's
  failed-day reporting.
- `refundAiCredit`'s docstring (`server/utils/ai-limits.ts:71`) claims it is
  "Safe to call multiple times if a single consume succeeded." It is not: the
  SQL is `GREATEST(count - 1, 0)`, so two calls on one consume mint the user a
  free credit. Separately, `ai.post.ts:38` consumes the credit *before* its
  auth/existence checks, so a 403/404 burns a credit — the other two AI
  endpoints deliberately consume after those checks and comment on it.

## Decisions (from brainstorming)

- **Full streaming**, not one or the other: live tool progress *and*
  token-by-token text.
- **Proposals arrive at the end**, on the final event — not as they are
  emitted. The `propose*` tools fire during the tool loop, so `proposalCollector`
  is already full before `response.text` exists; streaming cards as emitted
  would put actionable buttons on screen before the reasoning that justifies
  them, contradicting the system prompt's "Text reasoning comes first; the
  proposal is the follow-through", and would shift layout under a user who is
  still reading.
- **Refund only if nothing streamed.** No text AND no proposals → refund.
  Anything delivered → charged. This extends the existing
  `fallbackDiscussMessage` rule verbatim rather than inventing a second one.
- **Transport: SSE via h3's `createEventStream`** (approach A). NDJSON over a
  raw `ReadableStream` (approach B) is the named fallback — same four events,
  different framing — if the `@experimental` API or Vercel buffering bites.
- **Scope:** streaming + the two credit-correctness defects above. Chat
  persistence stays out, as ruled by the Phase 2 / AI-chat-rework specs ("No
  chat history / persistence… No new database tables").

## Feasibility (verified against installed versions)

- `@mastra/core@1.50.1` — `Agent.stream(messages, options)`
  (`node_modules/@mastra/core/dist/agent/agent.d.ts:1193`) is the current,
  non-legacy sibling of the `generate()` already in use. Both share
  `AgentExecutionOptionsBase`: `toolsets`, `maxSteps`, `onStepFinish`, plus
  `onChunk` and `abortSignal`. Returns `MastraModelOutput` with `.textStream`,
  `.fullStream`, and `.text: Promise<string>`. `generateLegacy()`/`streamLegacy()`
  are the deprecated AI-SDK-v4-era path and must not be used.
- Tool visibility: `fullStream`/`onChunk` emit a typed union
  (`@mastra/core/dist/stream/types.d.ts:769`). The decisive event is
  **`tool-call`** — it carries the full `{ toolCallId, toolName, args }` and
  fires *before* the tool executes, which is what makes "searching Google Maps
  for 'X'…" possible. (`tool-call-input-streaming-start` carries only a
  toolName and is not enough; `tool-result`/`tool-error` come too late.)
- `h3@1.15.11` ships `createEventStream(event)` → `push()` / `onClosed()` /
  `send()` (`h3/dist/index.d.ts:1312`), the idiomatic Nitro pattern. h3's own
  doc comment marks it `@experimental` — this is the known risk that makes
  approach B the fallback.
- Vercel: Nitro's `vercel` (Node) preset — which this project auto-selects —
  always writes `.vc-config.json` with `supportsResponseStreaming: true`
  (`node_modules/nitropack/dist/presets/vercel/utils.mjs:47`). Under Fluid
  Compute (default-on), function duration is 300s default/max on Hobby, 300s
  default / 800s max on Pro. `vercel.json` sets no `maxDuration`, and the
  current non-streaming endpoint already runs under that same ceiling:
  **streaming changes delivery, not duration**, so it is not new exposure.
  (This corrects an earlier assumption, carried in the Phase 3 spec's SSE
  rejection, that the default limit was ~10-60s. Phase 3's rejection remains
  correct on its own terms — a multi-minute whole-trip generation in one
  request is a different shape from a single chat turn.)
- Client: `EventSource` is unusable (GET-only; we POST a body). The approach is
  `fetch()` + a `ReadableStream` reader. `@ai-sdk/vue`'s `useChat` is not
  installed and does not fit this app's domain shapes (proposal cards with
  `groupId`, the tool summary).
- Abort propagation: the `vercel` preset bridges to real Node `req`/`res` via
  `toNodeListener`, so `EventStream.onClosed()` / `event.node.req.on("close")`
  fire on client disconnect. `H3Event` carries no built-in `AbortSignal` in
  this h3 version — we wire our own and pass it to `agent.stream({ abortSignal })`.

**Verified by reading, not by deploying.** A Vercel preview spike was offered
and declined. Two things therefore remain unproven until this ships to a
preview: whether Vercel's Lambda-streaming bridge buffers `text/event-stream`
(which would defeat the feature), and how promptly a client TCP close
propagates back to the Node process (which the cancel→abort behavior depends
on). Mitigation: both are transport-level, and approach B is a contained
fallback that changes only framing. **The implementation plan must include a
preview-deploy check of incremental delivery before this is called done** —
`bun test` cannot observe either property.

## Design

### 1. Endpoint — `server/api/trips/[id]/discuss.post.ts`

**Pre-flight is unchanged and stays where it is.** Auth → body validation →
injection check → sanitize → access → trip existence → context build → tools →
`tryConsumeAiCredit` → the existing refund wrap. This ordering is load-bearing:
**once the first byte ships with a 200, no 4xx/5xx can follow.** Every rejection
needing a real status code must therefore happen before `createEventStream` is
called. Nothing above the current `discussAgent.generate(...)` line moves.

Only then: open the stream, and replace `generate` with

```ts
const result = await discussAgent.stream(cleanMessages, {
  toolsets: { discuss: tools },
  maxSteps: 10,
  abortSignal: controller.signal,
})
for await (const chunk of result.fullStream) { /* map + push */ }
```

Iterate `fullStream` **once** and switch on `chunk.type`, rather than mixing
`onChunk` with `.textStream` — one loop is the whole turn. Chunks are
`{ type, payload }` (verified in
`@mastra/core/dist/stream/types.d.ts:803,1020`), the same shape the current
`onStepFinish` already reads via `c.payload.toolName` / `c.payload.args`.

Discriminators confirmed present in the installed union: **`'tool-call'`**
(payload `ToolCallPayload` — fires before execution, carries the args),
**`'text-delta'`**, plus `'error'`, `'abort'` and `'finish'`. Everything else in
the union (workflow-*, network-*, reasoning-*, background-task-*) maps to
nothing.

**Wire protocol — four events:**

| Event | Payload | Source |
|---|---|---|
| `tool` | `{ line: string }` | `'tool-call'` chunks → the existing `describeToolCall()`, filtering `propose*` exactly as `toolCallSummary` does today |
| `text` | `{ delta: string }` | `'text-delta'` chunks |
| `done` | `{ message, proposals, toolCallSummary }` | `fallbackDiscussMessage()` for `message`; `stampGroup(proposalCollector, randomUUID())` for `proposals` |
| `error` | `{ message: string }` | in-stream failure (the stream is already 200; this is the only way to report) |

The existing `logTripAction` audit write stays, after the turn completes.

### 2. Credit accounting

Streaming multiplies the refund paths — pre-flight throw, mid-stream throw,
client disconnect, empty-reply fallback — from two to four, all inside one
handler. Since `refundAiCredit` is **not** idempotent (`GREATEST(count-1, 0)`),
every path must route through one guard:

```ts
let refunded = false
async function refundOnce() {
  if (refunded) return
  refunded = true
  await refundAiCredit(session.user.id)
}
```

Track `streamedAny = textDeltaCount > 0 || proposalCollector.length > 0`.

| Exit | Refunds |
|---|---|
| Any pre-flight throw (before consume) | 0 |
| Throw after consume, before stream opens (existing wrap) | 1 |
| Agent throws mid-stream, `streamedAny === false` | 1, then `error` event |
| Agent throws mid-stream, `streamedAny === true` | 0, then `error` event (partial text kept) |
| Client disconnects, `streamedAny === false` | 1 (abort the agent) |
| Client disconnects, `streamedAny === true` | 0 (abort the agent) |
| Clean finish, `fallbackDiscussMessage().shouldRefund` | 1 |
| Clean finish with text or proposals | 0 |

No path may refund twice. The implementation must include an explicit
enumeration of every exit, as `generate-outline.post.ts` did in Phase 3.

Client disconnect must abort the agent server-side via the `abortSignal`, so a
cancelled turn stops consuming model tokens. Today cancelling is pure waste:
`handleAiCancel` aborts the client fetch while the server runs to completion
and the credit stays spent.

### 3. Client — `app/pages/trips/[id].vue` + a stream reader

`handleAiSubmit` swaps `$fetch` for `fetch` + a reader, and appends the
assistant `ChatMessage` **immediately** (empty `content`, `streaming: true`),
then mutates it as events arrive:

- `tool` → push the line onto `msg.toolCallSummary`
- `text` → append the delta to `msg.content`
- `done` → set final `content`, `proposals`, `proposalStates`; `streaming: false`
- `error` → keep the partial text, append a `system` message

The existing `AbortController` wiring and `handleAiCancel` are kept — the abort
now reaches the server rather than being client-only.

`AiDock.vue:418-425` already renders `toolCallSummary` and `content` reactively,
so the live UI needs no dock redesign. Known cosmetic wart, accepted:
`content` renders via `renderMarkdown` + `v-html`, so a half-typed `**bold`
shows its asterisks until the delimiter closes. This is normal for streaming
chat and is not worth pre-parsing around.

The pre-existing empty-turn filter in the request body (dropping
`content.trim().length === 0` turns) stays — a partial/aborted assistant turn
must never poison the next request's history.

### 4. Error-swallowing fix — `server/lib/ai.ts`

Replace the swallow at `ai.ts:857-860` with a rethrow. `processUserRequest` has
exactly one caller (`ai.post.ts:120`), so the blast radius is that endpoint:
its existing catch fires → `refundAiCredit` → 502. Phase 3's failed-day
reporting begins telling the truth, and the day-AI stops charging for failures.

Behavior change, intended: turns that silently "succeeded" with zero activities
and the message "Something went wrong processing your request." (surfaced to
users as a normal 200 chat line via `[id].vue:990,1033`) now surface as errors.

### 5. Credit hygiene

- `server/utils/ai-limits.ts:71` — correct the docstring. It currently states
  the opposite of the truth about a money-handling function, and this spec adds
  the exact multi-refund call site it lies about.
- `server/api/trips/[id]/days/[dayId]/ai.post.ts:38` — move `tryConsumeAiCredit`
  after `requireTripAccess` and the trip/day existence checks, matching
  `discuss.post.ts:136-140` and `generate-outline.post.ts:52-55`. Re-verify the
  file's full refund enumeration afterwards; the sanitize-400 refund added in
  Phase 3 must still fire exactly once.

## Testing (TDD, `bun test <path>`)

Repo convention: pure functions are unit-tested; endpoints are verified by
review plus an explicit refund trace. The two genuinely bug-prone pure
functions here both get tests:

- **Chunk → event mapper** (`server/lib/discuss-stream.ts`): `'tool-call'`
  chunks map to a `tool` event carrying the `describeToolCall()` line;
  `propose*` tool calls are filtered out; `'text-delta'` chunks map to `text`;
  every other discriminator in the union (`'workflow-*'`, `'reasoning-*'`,
  `'step-start'`, …) maps to nothing. Injected fake chunks — never the real
  model. This is where `describeToolCall` gets reused rather than reimplemented,
  so the live line and the persisted summary can never drift.
- **SSE frame parser** (client): the decisive case is a frame **split mid-JSON
  across network reads** — the parser must buffer the remainder and emit only
  complete frames. Also: multiple frames in one read, `\n\n` boundaries, and a
  trailing partial frame. This is where streaming clients actually break.
- `fallbackDiscussMessage` already has coverage (`discuss-agent.test.ts`, 14
  tests) and its contract is unchanged.
- Endpoint: no harness. Review + the exit/refund enumeration above.
- **Preview-deploy check before done** (see Feasibility): confirm bytes arrive
  incrementally rather than buffered, and that cancelling mid-stream aborts the
  agent server-side. Neither is observable from `bun test`.

## Out of scope (deliberately)

- Chat history persistence and any new DB table or migration (ruled out by the
  earlier AI-chat specs; unchanged here).
- Streaming proposals as they are emitted (decided above).
- Converting the day-AI endpoints (`fill_gaps`, `optimize`) or Phase 3's
  generation loop to streaming. Only the discuss chat streams.
- Adopting `@ai-sdk/vue` / `useChat` or the AI SDK data-stream protocol.
- Reworking `AiDock`'s layout, the proposal-card UX, or the step budget.
