# Streaming Discuss Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream the discuss chat turn — live tool progress and token-by-token text — instead of returning one JSON blob after the whole agent loop finishes; and fix two pre-existing AI-credit defects the work touches.

**Architecture:** The endpoint keeps its entire pre-flight unchanged (auth → validation → injection check → sanitize → access → trip load → context → tools → `tryConsumeAiCredit` → refund wrap), because **once the first byte ships with a 200 no 4xx/5xx can follow**. Only then does it open an h3 `createEventStream` and swap `discussAgent.generate(...)` for `discussAgent.stream(...)`, iterating `fullStream` once and mapping chunks to four SSE events (`tool`, `text`, `done`, `error`). Proposals ride the final `done` event. The client swaps `$fetch` for `fetch` + a stream reader, appends the assistant message immediately, and mutates it as events land — `AiDock.vue` already renders `toolCallSummary` and `content` reactively, so no dock redesign.

**Tech Stack:** Nuxt 4 (Vue), Nitro server routes, h3 `createEventStream`, `@mastra/core@1.50.1` `Agent.stream()`, Google Gemini, Drizzle, `node:test` run via `bun test`.

## Global Constraints

- **Never use `any`.** No `as unknown as X` unless strictly necessary (project + global CLAUDE.md).
- **TDD:** write the failing test first, watch it fail, then implement.
- **Conventional Commits** (`feat:`, `fix:`, `test:`, `refactor:`).
- **Tests are `node:test` + `node:assert/strict`**, run with `bun test <path>`. There is **no** `bun run test` script — always pass the file path.
- **Formatting/lint gate:** `bun run check` (oxfmt + oxlint) must pass before each commit. It prints ~14 **pre-existing** warnings in files you are not touching (`no-underscore-dangle`, `no-unassigned-import`, `no-map-spread`) — expected, not yours to fix; just ensure it exits 0 and your files add none.
- **`bun run build` must pass** before the branch is done. KNOWN PRE-EXISTING FAILURE, do not chase: it fails at the very end at Nitro's output-copy/trace step with `ENAMETOOLONG` from a deeply-nested `better-auth`/`@better-auth/telemetry` circular dep (macOS path limit). Compilation succeeding before that point is a PASS.
- **AI credit accounting is the critical property of this branch.** Users pay real money. `refundAiCredit` is **NOT idempotent** — its SQL is `GREATEST(count - 1, 0)`, so two calls on one consume mint a free credit. Every refund path must route through a single `refundOnce()` guard. Every task touching a credit path must produce an explicit exit/refund enumeration.
- **Never persist chat history.** No new DB tables, no migrations (ruled out by the earlier AI-chat specs).
- A pre-commit hook runs `oxlint --fix && oxfmt --write .` and may reformat your files — expected.

## File Structure

| File                                            | Responsibility                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/lib/discuss-stream.ts` (new)            | Pure: `describeToolCall` (moved here) + `mapChunk` (Mastra chunk → stream event). Single source of truth so the live line and the persisted summary can't drift. |
| `server/lib/discuss-stream.test.ts` (new)       | Unit tests for the above with injected fake chunks.                                                                                                              |
| `app/utils/sse-parse.ts` (new)                  | Pure: `parseSseFrames(buffer)` → `{ frames, rest }`. Handles frames split mid-JSON across network reads.                                                         |
| `app/utils/sse-parse.test.ts` (new)             | Unit tests for the parser.                                                                                                                                       |
| `server/api/trips/[id]/discuss.post.ts`         | Streams via `createEventStream`; owns the `refundOnce` guard.                                                                                                    |
| `app/pages/trips/[id].vue`                      | `handleAiSubmit` reads the stream and mutates the assistant message.                                                                                             |
| `server/lib/ai.ts`                              | Workstream 2: rethrow instead of swallowing.                                                                                                                     |
| `server/utils/ai-limits.ts`                     | Workstream 3: correct the false docstring.                                                                                                                       |
| `server/api/trips/[id]/days/[dayId]/ai.post.ts` | Workstream 3: consume the credit after all validation.                                                                                                           |

---

### Task 1: `discuss-stream.ts` — chunk → event mapper

Pure, server-side, no network. Moves `describeToolCall` out of the endpoint so both the live `tool` event and the persisted `toolCallSummary` use one implementation.

**Files:**

- Create: `server/lib/discuss-stream.ts`
- Test: `server/lib/discuss-stream.test.ts`
- Modify: `server/api/trips/[id]/discuss.post.ts` (delete the local `describeToolCall` + `ToolSummaryEntry`, import from the new lib — **no other change in this task**)

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  export interface ToolSummaryEntry {
    toolId: string
    args: Record<string, unknown>
  }
  export function describeToolCall(entry: ToolSummaryEntry): string
  export interface StreamChunkLike {
    type: string
    payload?: unknown
  }
  export type DiscussStreamEvent = { type: "tool"; line: string } | { type: "text"; delta: string }
  export function mapChunk(chunk: StreamChunkLike): DiscussStreamEvent | null
  ```
  Task 1 Step 5 has the endpoint import `describeToolCall` + `ToolSummaryEntry` (it still calls `generate()` at that point). Task 3 then REPLACES that import with `mapChunk` alone, because the streaming endpoint never calls `describeToolCall` directly — `mapChunk` does. After Task 3, `describeToolCall`'s only consumers are `mapChunk` and this task's tests.

**Verified facts (do not re-derive):** the installed `@mastra/core@1.50.1` chunk union (`dist/stream/types.d.ts`) uses `{ type, payload }` shape. Discriminators: `'tool-call'` with `ToolCallPayload = { toolCallId, toolName, args?, … }` (fires BEFORE execution — this is what makes the live line possible) and `'text-delta'` with `TextDeltaPayload = { id, text }`. Everything else in the union (`'workflow-*'`, `'reasoning-*'`, `'step-start'`, `'finish'`, …) maps to nothing. `mapChunk` types its input structurally rather than importing Mastra's deep chunk type — that keeps it unit-testable and avoids `any`.

- [ ] **Step 1: Write the failing test**

Create `server/lib/discuss-stream.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { describeToolCall, mapChunk, type StreamChunkLike } from "./discuss-stream"

function toolCall(toolName: string, args: Record<string, unknown> = {}): StreamChunkLike {
  return { type: "tool-call", payload: { toolCallId: "tc1", toolName, args } }
}

describe("mapChunk", () => {
  it("maps a tool-call chunk to a tool event using describeToolCall", () => {
    const ev = mapChunk(toolCall("searchPlaces", { query: "ramen Shinjuku" }))
    assert.deepEqual(ev, { type: "tool", line: "searched Google Maps for 'ramen Shinjuku'" })
  })

  it("filters out propose* tool calls (they are proposals, not progress)", () => {
    assert.equal(mapChunk(toolCall("proposeAddActivities", { dayId: "d1" })), null)
    assert.equal(mapChunk(toolCall("proposeReschedule")), null)
  })

  it("maps a text-delta chunk to a text event", () => {
    const ev = mapChunk({ type: "text-delta", payload: { id: "t1", text: "Planets is " } })
    assert.deepEqual(ev, { type: "text", delta: "Planets is " })
  })

  it("ignores an empty text delta", () => {
    assert.equal(mapChunk({ type: "text-delta", payload: { id: "t1", text: "" } }), null)
  })

  it("maps every other chunk type to nothing", () => {
    for (const type of [
      "step-start",
      "finish",
      "reasoning-delta",
      "tool-result",
      "tool-call-input-streaming-start",
      "workflow-start",
      "response-metadata",
    ]) {
      assert.equal(mapChunk({ type, payload: {} }), null, `${type} should map to nothing`)
    }
  })

  it("survives malformed payloads without throwing", () => {
    assert.equal(mapChunk({ type: "tool-call" }), null)
    assert.equal(mapChunk({ type: "tool-call", payload: null }), null)
    assert.equal(mapChunk({ type: "tool-call", payload: { toolName: 42 } }), null)
    assert.equal(mapChunk({ type: "text-delta", payload: { text: 42 } }), null)
  })

  it("tolerates a tool-call with no args", () => {
    const ev = mapChunk({ type: "tool-call", payload: { toolCallId: "x", toolName: "readDay" } })
    assert.deepEqual(ev, { type: "tool", line: "checked the day's schedule" })
  })
})

describe("describeToolCall", () => {
  it("describes each known tool", () => {
    assert.equal(describeToolCall({ toolId: "readDay", args: {} }), "checked the day's schedule")
    assert.equal(describeToolCall({ toolId: "readTripSummary", args: {} }), "reviewed your trip")
    assert.equal(
      describeToolCall({ toolId: "getDistance", args: {} }),
      "checked travel time between two stops",
    )
    assert.equal(
      describeToolCall({ toolId: "webSearch", args: { query: "festival dates" } }),
      "searched the web for 'festival dates'",
    )
    assert.equal(
      describeToolCall({ toolId: "getPlaceDetails", args: {} }),
      "looked up venue details",
    )
    assert.equal(
      describeToolCall({ toolId: "runReview", args: {} }),
      "ran a structural check on the itinerary",
    )
  })

  it("falls back to the raw tool id for an unknown tool", () => {
    assert.equal(describeToolCall({ toolId: "somethingNew", args: {} }), "somethingNew")
  })

  it("truncates a long query to 80 chars", () => {
    const line = describeToolCall({ toolId: "searchPlaces", args: { query: "x".repeat(200) } })
    assert.equal(line, `searched Google Maps for '${"x".repeat(80)}'`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/lib/discuss-stream.test.ts`
Expected: FAIL — module `./discuss-stream` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `server/lib/discuss-stream.ts`. `describeToolCall` and `ToolSummaryEntry` are moved **verbatim** from `discuss.post.ts` (lines ~30-33 and ~101-121) — do not reword the copy, it is user-facing and already shipped:

```ts
/**
 * Pure mapping from Mastra stream chunks to the discuss endpoint's SSE events.
 *
 * `describeToolCall` lives here (rather than in the endpoint) so the LIVE tool
 * line and the persisted `toolCallSummary` are produced by one implementation
 * and can never drift apart.
 */

export interface ToolSummaryEntry {
  toolId: string
  args: Record<string, unknown>
}

export function describeToolCall(entry: ToolSummaryEntry): string {
  const args = entry.args
  switch (entry.toolId) {
    case "readDay":
      return "checked the day's schedule"
    case "readTripSummary":
      return "reviewed your trip"
    case "searchPlaces":
      return `searched Google Maps for '${String(args.query ?? "").slice(0, 80)}'`
    case "getPlaceDetails":
      return "looked up venue details"
    case "getDistance":
      return "checked travel time between two stops"
    case "webSearch":
      return `searched the web for '${String(args.query ?? "").slice(0, 80)}'`
    case "runReview":
      return "ran a structural check on the itinerary"
    default:
      return entry.toolId
  }
}

/**
 * Structural shape of a Mastra stream chunk. Typed structurally rather than
 * importing the library's deep chunk union: this keeps the mapper unit-testable
 * with plain object literals and independent of Mastra's internal type layout.
 */
export interface StreamChunkLike {
  type: string
  payload?: unknown
}

export type DiscussStreamEvent = { type: "tool"; line: string } | { type: "text"; delta: string }

function asToolCallPayload(
  p: unknown,
): { toolName: string; args?: Record<string, unknown> } | null {
  if (typeof p !== "object" || p === null) return null
  const { toolName, args } = p as { toolName?: unknown; args?: unknown }
  if (typeof toolName !== "string") return null
  const safeArgs =
    typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined
  return { toolName, args: safeArgs }
}

function asTextDeltaPayload(p: unknown): { text: string } | null {
  if (typeof p !== "object" || p === null) return null
  const { text } = p as { text?: unknown }
  return typeof text === "string" ? { text } : null
}

/**
 * Map one chunk to an outbound event, or null if it carries nothing the user
 * should see. Only `tool-call` (fires BEFORE the tool runs, so the line can say
 * what is happening now) and `text-delta` are surfaced.
 */
export function mapChunk(chunk: StreamChunkLike): DiscussStreamEvent | null {
  if (chunk.type === "tool-call") {
    const payload = asToolCallPayload(chunk.payload)
    if (!payload) return null
    // propose* calls ARE the proposals — they ride the final `done` event as
    // cards, and must never show up as progress lines. Mirrors the existing
    // toolCallSummary filter.
    if (payload.toolName.startsWith("propose")) return null
    return {
      type: "tool",
      line: describeToolCall({ toolId: payload.toolName, args: payload.args ?? {} }),
    }
  }

  if (chunk.type === "text-delta") {
    const payload = asTextDeltaPayload(chunk.payload)
    if (!payload || payload.text.length === 0) return null
    return { type: "text", delta: payload.text }
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server/lib/discuss-stream.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Point the endpoint at the moved helper**

In `server/api/trips/[id]/discuss.post.ts`: delete the local `ToolSummaryEntry` interface (~line 30-33) and the local `describeToolCall` function (~line 101-121), and add the import:

```ts
import { describeToolCall, type ToolSummaryEntry } from "../../../lib/discuss-stream"
```

Change **nothing else** in this task — the endpoint still calls `generate()`. This step only proves the move is behaviour-neutral.

- [ ] **Step 6: Verify and commit**

```bash
bunx nuxi typecheck   # must be clean for both files
bun test server/lib/discuss-stream.test.ts server/lib/discuss-agent.test.ts
bun run check
git add server/lib/discuss-stream.ts server/lib/discuss-stream.test.ts server/api/trips/\[id\]/discuss.post.ts
git commit -m "refactor(ai): extract describeToolCall and add discuss stream chunk mapper"
```

---

### Task 2: `sse-parse.ts` — client SSE frame parser

Pure, client-side. This is where streaming clients actually break: the network hands you arbitrary byte chunks, so a single SSE frame routinely arrives split **mid-JSON** across two reads.

**Files:**

- Create: `app/utils/sse-parse.ts`
- Test: `app/utils/sse-parse.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  export interface SseFrame {
    event: string
    data: string
  }
  export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string }
  ```
  Task 4 calls this in a read loop, feeding `rest` back in as the prefix of the next buffer.

**Format note:** h3's `EventStream.push({ event, data })` emits `event: <name>\ndata: <payload>\n\n`. Per the SSE spec a frame may carry multiple `data:` lines (joined with `\n`) and lines starting with `:` are comments/heartbeats to ignore.

- [ ] **Step 1: Write the failing test**

Create `app/utils/sse-parse.test.ts`:

```ts
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseSseFrames } from "./sse-parse"

describe("parseSseFrames", () => {
  it("parses a single complete frame", () => {
    const { frames, rest } = parseSseFrames('event: text\ndata: {"delta":"hi"}\n\n')
    assert.deepEqual(frames, [{ event: "text", data: '{"delta":"hi"}' }])
    assert.equal(rest, "")
  })

  it("parses multiple frames arriving in one read", () => {
    const buf = 'event: tool\ndata: {"line":"a"}\n\nevent: text\ndata: {"delta":"b"}\n\n'
    const { frames, rest } = parseSseFrames(buf)
    assert.deepEqual(frames, [
      { event: "tool", data: '{"line":"a"}' },
      { event: "text", data: '{"delta":"b"}' },
    ])
    assert.equal(rest, "")
  })

  it("holds back a trailing partial frame as rest", () => {
    const { frames, rest } = parseSseFrames('event: text\ndata: {"delta":"hi"}\n\nevent: te')
    assert.equal(frames.length, 1)
    assert.equal(rest, "event: te")
  })

  it("reassembles a frame split mid-JSON across two reads", () => {
    // This is the case that breaks naive parsers.
    const first = parseSseFrames('event: done\ndata: {"message":"hel')
    assert.deepEqual(first.frames, [])
    assert.equal(first.rest, 'event: done\ndata: {"message":"hel')

    const second = parseSseFrames(first.rest + 'lo","proposals":[]}\n\n')
    assert.deepEqual(second.frames, [{ event: "done", data: '{"message":"hello","proposals":[]}' }])
    assert.equal(second.rest, "")
    assert.deepEqual(JSON.parse(second.frames[0]!.data), { message: "hello", proposals: [] })
  })

  it("defaults the event name to 'message' when absent", () => {
    const { frames } = parseSseFrames("data: bare\n\n")
    assert.deepEqual(frames, [{ event: "message", data: "bare" }])
  })

  it("joins multi-line data with newlines, per the SSE spec", () => {
    const { frames } = parseSseFrames("event: text\ndata: line1\ndata: line2\n\n")
    assert.deepEqual(frames, [{ event: "text", data: "line1\nline2" }])
  })

  it("ignores comment/heartbeat lines and frames with no data", () => {
    const { frames, rest } = parseSseFrames(": keep-alive\n\nevent: tool\ndata: x\n\n")
    assert.deepEqual(frames, [{ event: "tool", data: "x" }])
    assert.equal(rest, "")
  })

  it("tolerates CRLF line endings", () => {
    const { frames } = parseSseFrames("event: text\r\ndata: hi\r\n\r\n")
    assert.deepEqual(frames, [{ event: "text", data: "hi" }])
  })

  it("preserves JSON containing a literal \\n\\n inside a string", () => {
    const payload = JSON.stringify({ delta: "para1\n\npara2" })
    const { frames, rest } = parseSseFrames(`event: text\ndata: ${payload}\n\n`)
    assert.equal(rest, "")
    assert.equal(frames.length, 1)
    assert.deepEqual(JSON.parse(frames[0]!.data), { delta: "para1\n\npara2" })
  })

  it("returns nothing for an empty buffer", () => {
    assert.deepEqual(parseSseFrames(""), { frames: [], rest: "" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test app/utils/sse-parse.test.ts`
Expected: FAIL — module `./sse-parse` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `app/utils/sse-parse.ts`:

```ts
/**
 * Incremental Server-Sent Events frame parser.
 *
 * The network delivers arbitrary byte chunks, so one SSE frame routinely
 * arrives split mid-JSON across two reads. Callers keep a buffer, hand it here,
 * and feed the returned `rest` back in as the prefix of the next read — only
 * complete frames are ever emitted.
 *
 * NOTE: JSON payloads may themselves contain an escaped "\n\n"; that is safe
 * because JSON.stringify escapes real newlines to the two characters \ and n,
 * so they can never look like a frame boundary.
 */

export interface SseFrame {
  event: string
  data: string
}

export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  // Normalize CRLF so the boundary scan only has to consider "\n\n".
  let rest = buffer.replace(/\r\n/g, "\n")
  const frames: SseFrame[] = []

  for (;;) {
    const idx = rest.indexOf("\n\n")
    if (idx === -1) break

    const raw = rest.slice(0, idx)
    rest = rest.slice(idx + 2)

    let event = "message"
    const dataLines: string[] = []
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue // comment / heartbeat
      if (line.startsWith("event:")) {
        event = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        // A single leading space after the colon is part of the framing.
        dataLines.push(line.slice(5).replace(/^ /, ""))
      }
    }

    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") })
  }

  return { frames, rest }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test app/utils/sse-parse.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
bun run check
git add app/utils/sse-parse.ts app/utils/sse-parse.test.ts
git commit -m "feat(ai): add incremental SSE frame parser for streamed chat"
```

---

### Task 3: Stream the discuss endpoint

The credit-critical task. **No test harness** (repo convention for endpoints) — your care and the refund enumeration ARE the deliverable.

**Files:**

- Modify: `server/api/trips/[id]/discuss.post.ts`

**Interfaces:**

- Consumes: `mapChunk` from `../../../lib/discuss-stream` (Task 1); `createEventStream` from `h3`; existing `discussAgent`, `fallbackDiscussMessage`, `stampGroup`, `refundAiCredit`, `logTripAction`.
- Produces: `POST /api/trips/[id]/discuss` now returns `text/event-stream` with four events. Task 4's client consumes exactly this:
  - `event: tool` → `{ line: string }`
  - `event: text` → `{ delta: string }`
  - `event: done` → `{ message: string, proposals: Proposal[], toolCallSummary: string[] }`
  - `event: error` → `{ message: string }`

**Verified API facts (do not re-derive):**

- `createEventStream(event, opts?)` returns an `EventStream` with `push(msg: EventStreamMessage): Promise<void>` where `EventStreamMessage = { id?, event?, retry?, data: string }`, plus `onClosed(cb)`, `close()`, and `send()`. **The handler must `return stream.send()`** and do the pushing from a background async IIFE — that is h3's documented pattern (`h3/dist/index.d.ts:1244-1312`). `createEventStream` is marked `@experimental`; if it misbehaves, the spec's named fallback is NDJSON over a raw `ReadableStream` (same four events, different framing) — escalate before switching.
- `discussAgent.stream(messages, options)` accepts the SAME `AgentExecutionOptionsBase` the current `generate()` call uses — `toolsets`, `maxSteps` — plus `abortSignal?: AbortSignal`. It returns `Promise<MastraModelOutput>`; `.fullStream` is a `ReadableStream<ChunkType>` you can `for await` over. Do NOT use `streamLegacy()`/`generateLegacy()` (deprecated AI-SDK-v4 path).

**THE ORDERING RULE — read before touching anything:** everything above the current `discussAgent.generate(...)` call (line ~221) stays exactly where it is. That whole pre-flight — auth, body validation, injection check, sanitize, access, trip 404, day cross-trip check, context build, `getExchangeRate`, tools, `tryConsumeAiCredit`, and the existing refund `try/catch` — must run BEFORE `createEventStream`, because once a byte ships with a 200 no 4xx/5xx can follow. Do not "tidy" any of it.

- [ ] **Step 1: Add the refundOnce guard and route the existing wrap through it**

`refundAiCredit` is NOT idempotent (`GREATEST(count-1,0)`), and streaming takes the refund paths from two to four in one handler. Immediately after `await tryConsumeAiCredit(session.user.id)` (line ~140), add:

```ts
// refundAiCredit is NOT idempotent — its SQL is GREATEST(count - 1, 0), so two
// calls on a single consume mint the user a free credit. Streaming multiplies
// the refund paths (pre-stream throw, mid-stream throw, client disconnect,
// empty-reply fallback), so every one of them routes through this guard.
let refunded = false
async function refundOnce(): Promise<void> {
  if (refunded) return
  refunded = true
  await refundAiCredit(session.user.id)
}
```

Then, in the EXISTING pre-stream `catch` (line ~212-217), replace `await refundAiCredit(session.user.id)` with `await refundOnce()`. Leave its comment and `throw e` alone.

- [ ] **Step 2: Replace the generate call with the stream**

Delete the whole existing block from `let assistantText = ""` (line ~219) through the end of the handler (the `return { success: true, ... }` at ~281-287), and replace with:

```ts
const controller = new AbortController()
const stream = createEventStream(event)

// Client disconnect (tab closed, Cancel pressed) aborts the agent so a
// cancelled turn stops burning model tokens. Before this, cancelling only
// aborted the client fetch — the server ran to completion and the credit
// stayed spent.
stream.onClosed(() => {
  controller.abort()
})

let streamedText = ""
const toolLines: string[] = []

// Pushed in the background; the handler returns stream.send() immediately.
void (async () => {
  try {
    const result = await discussAgent.stream(cleanMessages, {
      toolsets: { discuss: tools },
      maxSteps: 10,
      abortSignal: controller.signal,
    })

    for await (const chunk of result.fullStream) {
      const mapped = mapChunk(chunk)
      if (!mapped) continue
      if (mapped.type === "tool") {
        toolLines.push(mapped.line)
        await stream.push({ event: "tool", data: JSON.stringify({ line: mapped.line }) })
      } else {
        streamedText += mapped.delta
        await stream.push({ event: "text", data: JSON.stringify({ delta: mapped.delta }) })
      }
    }

    // The user got value iff they saw text or got proposals. This is the
    // existing fallbackDiscussMessage rule, extended to streaming.
    const streamedAny = streamedText.length > 0 || proposalCollector.length > 0

    if (controller.signal.aborted) {
      if (!streamedAny) await refundOnce()
      await stream.close()
      return
    }

    const final = fallbackDiscussMessage(streamedText, proposalCollector.length)
    if (final.shouldRefund) await refundOnce()

    const groupedProposals = stampGroup(proposalCollector, randomUUID())

    await stream.push({
      event: "done",
      data: JSON.stringify({
        message: final.message,
        proposals: groupedProposals,
        toolCallSummary: toolLines,
      }),
    })

    console.log(
      `[discuss] activeDay=${dayId ?? "none"} proposals=[${groupedProposals
        .map((p) => `${p.kind}@${p.dayId}`)
        .join(", ")}]`,
    )

    await logTripAction({
      tripId: id,
      userId: session.user.id,
      action: "ai_discuss",
      description: `AI discuss: ${final.message.slice(0, 200)}`,
      metadata: {
        proposalCount: proposalCollector.length,
        toolCalls: toolLines.length,
      },
    })

    await stream.close()
  } catch (e) {
    console.error("[discuss] agent failed:", e)
    const streamedAny = streamedText.length > 0 || proposalCollector.length > 0
    if (!streamedAny) await refundOnce()
    // A client disconnect surfaces here as an abort error; the socket is
    // already gone, so pushing would throw.
    if (!controller.signal.aborted) {
      await stream.push({
        event: "error",
        data: JSON.stringify({
          message: "Sorry — I couldn't think that through right now. Try again in a moment.",
        }),
      })
    }
    await stream.close()
  }
})()

return stream.send()
```

Fix the imports at the top of the file. After this rewrite the endpoint no longer calls `describeToolCall` itself (`mapChunk` does it) and no longer builds `ToolSummaryEntry` values, so **Task 1 Step 5's import is replaced**, not extended:

```ts
import { createEventStream } from "h3"
import { mapChunk } from "../../../lib/discuss-stream"
```

Notes for the implementer:

- The `toolCalls: ToolSummaryEntry[]` collector, its `let` declaration, and the whole `onStepFinish` callback are deleted — `toolLines` replaces them, already filtered and described by `mapChunk`. `describeToolCall` and `ToolSummaryEntry` must disappear from this file's imports entirely (oxlint will flag them as unused otherwise); they live on in `discuss-stream.ts` and are still exercised by Task 1's tests.
- The old `toolCallSummary` was built as `toolCalls.filter((c) => !c.toolId.startsWith("propose")).map(describeToolCall)`. `mapChunk` now applies both the `propose*` filter and `describeToolCall`, so `toolLines` is already the finished list — do not filter or map it again.
- `logTripAction`'s `metadata.toolCalls` was an array of tool ids; it is now a count. That is a deliberate simplification — `mapChunk` deliberately discards the raw ids. If you would rather keep the array, collect the ids alongside `toolLines`; either is acceptable, but say which you did in your report.

- [ ] **Step 3: Typecheck**

Run: `bunx nuxi typecheck`
Expected: clean for `discuss.post.ts`. Fix any error with real types — never `any`, never a cast to silence the chunk union.

- [ ] **Step 4: Produce the exit/refund enumeration — this is the deliverable**

Enumerate EVERY exit from this handler in your report: each throw site (including throws inside awaited calls and inside the catch) and each successful return. For each, state how many refunds fire. It must be exactly:

| Exit                                                           | Refunds |
| -------------------------------------------------------------- | ------- |
| Any pre-flight throw (before `tryConsumeAiCredit`)             | 0       |
| Throw after consume, before the stream opens (existing wrap)   | 1       |
| Agent throws mid-stream, nothing streamed                      | 1       |
| Agent throws mid-stream, text or proposals already sent        | 0       |
| Client disconnects, nothing streamed                           | 1       |
| Client disconnects, text or proposals already sent             | 0       |
| Clean finish, `fallbackDiscussMessage().shouldRefund === true` | 1       |
| Clean finish with text or proposals                            | 0       |

**No path may fire 2.** State explicitly why the pre-stream wrap and the in-stream catch cannot both fire for one request, and confirm `refundOnce` is the only route to `refundAiCredit` in the file (`grep -n "refundAiCredit" server/api/trips/\[id\]/discuss.post.ts` — expect exactly the import, the guard body, and nothing else).

- [ ] **Step 5: Commit**

```bash
bun run check
git add server/api/trips/\[id\]/discuss.post.ts
git commit -m "feat(ai): stream the discuss chat turn over SSE"
```

---

### Task 4: Client stream reader

**Files:**

- Modify: `app/pages/trips/[id].vue` — `handleAiSubmit` (~line 770-822) and `handleAiCancel` (~line 824-827)

**Interfaces:**

- Consumes: `parseSseFrames` from `../../utils/sse-parse` (Task 2); the four events from Task 3.
- Produces: nothing downstream.

**Context the implementer needs:**

- `ChatMessage` is defined in `app/components/AiDock.vue:53-61`: `{ id, role, content, toolCallSummary?, proposals?, proposalStates?, timestamp }`. **Do not add fields to it** — the dock already renders `toolCallSummary` (line 418) and `content` (line 425) reactively, so live updates need no new state.
- Keep the existing empty-turn filter when building the request body (it drops `content.trim().length === 0` turns) — a partial or aborted assistant turn must never poison the next request's history validation.
- Keep the existing `aiAbort` / `AbortController` wiring. The abort now reaches the server.
- Pre-flight rejections (429 limit, 400 injection) still arrive as real HTTP errors BEFORE any stream — handle `!res.ok` by reading the JSON body's `message`.

- [ ] **Step 1: Rewrite `handleAiSubmit`**

Replace the body of `handleAiSubmit` (keep the function name and signature):

```ts
async function handleAiSubmit(text: string) {
  if (!trip.value) return
  const userMsg: ChatMessage = {
    id: makeMessageId(),
    role: "user",
    content: text,
    timestamp: Date.now(),
  }
  aiMessages.value = [...aiMessages.value, userMsg]
  aiInput.value = ""
  aiChatLoading.value = true
  const controller = new AbortController()
  aiAbort = controller

  // The assistant bubble is appended EMPTY and mutated as events arrive — that
  // is what makes tool lines and text appear live.
  const assistantId = makeMessageId()
  aiMessages.value = [
    ...aiMessages.value,
    {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCallSummary: [],
      timestamp: Date.now(),
    },
  ]

  const patch = (fn: (m: ChatMessage) => ChatMessage) => {
    aiMessages.value = aiMessages.value.map((m) => (m.id === assistantId ? fn(m) : m))
  }

  try {
    const body = {
      messages: aiMessages.value
        // Drop empty turns: a historical empty assistant message (from the
        // pre-fix silent-reply bug) would fail the server's content min(1)
        // validation and brick the chat for every subsequent send. The
        // just-appended streaming placeholder is empty too, so this also keeps
        // it out of its own request.
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      dayId: activeDay.value?.id,
    }

    const res = await fetch(`/api/trips/${tripId}/discuss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      // Pre-flight rejection (429 limit, 400 injection) — no stream was opened.
      const detail = await res.json().catch(() => null)
      throw new Error(
        (detail as { message?: string } | null)?.message ?? "AI is unavailable right now",
      )
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    let streamError = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const { frames, rest } = parseSseFrames(buf)
      buf = rest

      for (const frame of frames) {
        const payload: unknown = JSON.parse(frame.data)
        if (frame.event === "tool") {
          const { line } = payload as { line: string }
          patch((m) => ({ ...m, toolCallSummary: [...(m.toolCallSummary ?? []), line] }))
        } else if (frame.event === "text") {
          const { delta } = payload as { delta: string }
          patch((m) => ({ ...m, content: m.content + delta }))
        } else if (frame.event === "done") {
          const done_ = payload as {
            message: string
            proposals: Proposal[]
            toolCallSummary: string[]
          }
          patch((m) => ({
            ...m,
            content: done_.message,
            toolCallSummary: done_.toolCallSummary,
            proposals: done_.proposals,
            proposalStates: Object.fromEntries(
              done_.proposals.map((p) => [p.id, "pending" as const]),
            ),
          }))
        } else if (frame.event === "error") {
          streamError = (payload as { message: string }).message
        }
      }
    }

    if (streamError) {
      aiMessages.value = [
        ...aiMessages.value,
        {
          id: makeMessageId(),
          role: "system",
          content: streamError,
          timestamp: Date.now(),
        },
      ]
    }
  } catch (e: unknown) {
    // User cancelled — keep whatever already streamed, add no error line.
    if (controller.signal.aborted) {
      dropEmptyAssistant(assistantId)
      return
    }
    dropEmptyAssistant(assistantId)
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: makeMessageId(),
        role: "system",
        content: e instanceof Error ? e.message : "AI failed",
        timestamp: Date.now(),
      },
    ]
  } finally {
    aiChatLoading.value = false
    await refreshAiUsage()
  }
}

/**
 * Remove the streaming placeholder if it never received anything. An empty
 * assistant bubble renders as a blank row and is dead weight in the history.
 */
function dropEmptyAssistant(id: string) {
  aiMessages.value = aiMessages.value.filter(
    (m) => m.id !== id || m.content.trim().length > 0 || (m.proposals?.length ?? 0) > 0,
  )
}
```

Add the import near the other util imports at the top of `<script setup>`:

```ts
import { parseSseFrames } from "../../utils/sse-parse"
```

- [ ] **Step 2: Verify `handleAiCancel` still clears state**

`handleAiCancel` (~line 824) already calls `aiAbort?.abort()` and clears `aiChatLoading`. Leave it as-is — the abort now propagates to the server via the fetch signal, which closes the socket, which fires the endpoint's `onClosed`. Confirm by reading that no other code path sets `aiChatLoading` true without a matching `finally`.

- [ ] **Step 3: Typecheck and build**

```bash
bunx nuxi typecheck   # clean for [id].vue
bun run build         # must compile client+server; the known ENAMETOOLONG trace failure at the very end is a PASS
bun test app/utils/sse-parse.test.ts
```

- [ ] **Step 4: Commit**

```bash
bun run check
git add app/pages/trips/\[id\].vue
git commit -m "feat(ai): render the discuss reply as it streams"
```

---

### Task 5: Stop `processUserRequest` swallowing handler errors

**Files:**

- Modify: `server/lib/ai.ts` (~line 857-860)

**Interfaces:**

- Consumes: nothing.
- Produces: `processUserRequest` now throws instead of returning a "Something went wrong" result. Its single caller (`server/api/trips/[id]/days/[dayId]/ai.post.ts:120`) already has the catch that turns this into a refund + 502.

**Why:** the catch currently logs `=== HANDLER FAILED ===`, sets `result.message`, and **returns normally** with empty arrays. So `ai.post.ts`'s catch never fires: no 502, no refund. The user is charged, gets a 200, and `[id].vue:990,1033` renders `data.message ?? "Filled gaps."` as a normal chat line over an empty day. Phase 3's failed-day reporting silently never fires either, because the day counts as a success.

**Blast radius (verified):** `processUserRequest` has exactly ONE caller — `ai.post.ts:120`. Nothing else in `server/` or `app/` imports it.

- [ ] **Step 1: Make the change**

In `server/lib/ai.ts`, replace:

```ts
  } catch (e) {
    logger.error("=== HANDLER FAILED ===", { intent, error: String(e) })
    result.message = "Something went wrong processing your request. Please try again."
  }
```

with:

```ts
  } catch (e) {
    // Rethrow — do NOT swallow. ai.post.ts's catch turns this into a 502 AND
    // refunds the credit. Swallowing it returned 200 with zero activities: the
    // user was charged, the page reported success over an empty day, and the
    // full-itinerary loop counted the day as generated.
    logger.error("=== HANDLER FAILED ===", { intent, error: String(e) })
    throw e
  }
```

Everything after the try/catch (the `normalizeSuggestedTime`/`clampDurationMinutes` post-processing and `return result`) is now correctly skipped on failure.

- [ ] **Step 2: Verify the caller's refund still fires exactly once**

Read `ai.post.ts:119-159`. Confirm: `processUserRequest` throws → the existing catch at ~152 fires → `refundAiCredit` once → 502. Confirm no OTHER catch in that file can also refund the same request. Put this trace in your report.

- [ ] **Step 3: Verify and commit**

```bash
bunx nuxi typecheck
bun test server/lib/   # no regressions
bun run check
git add server/lib/ai.ts
git commit -m "fix(ai): rethrow handler failures instead of returning a fake success"
```

---

### Task 6: Credit hygiene

**Files:**

- Modify: `server/utils/ai-limits.ts` (~line 71)
- Modify: `server/api/trips/[id]/days/[dayId]/ai.post.ts` (~lines 33-51)

**Interfaces:**

- Consumes: nothing. Produces: nothing. Behaviour-preserving except that a 403/404 no longer burns a credit.

- [ ] **Step 1: Correct the false docstring**

`server/utils/ai-limits.ts:71` currently claims `refundAiCredit` is "Safe to call multiple times if a single consume succeeded." **This is false and dangerous** — the SQL is `GREATEST(count - 1, 0)`, which decrements on EVERY call, so two calls on one consume mint the user a free credit. Replace that sentence with the truth:

```ts
/**
 * Give back one AI credit.
 *
 * NOT idempotent: the SQL is `GREATEST(count - 1, 0)`, so calling this twice for
 * a single consume decrements twice and mints the user a free credit. Each
 * request must refund at most once — where a handler has several failure paths,
 * route them all through one guard (see discuss.post.ts's `refundOnce`).
 */
```

Keep the rest of the docstring and the implementation unchanged.

- [ ] **Step 2: Consume the credit after ALL validation**

`ai.post.ts` currently calls `tryConsumeAiCredit` at line ~38 — before `requireTripAccess` (~53), the trip 404 (~59), and the day 404 (~73). So a 403 or 404 burns a credit. `discuss.post.ts:136-140` and `generate-outline.post.ts:52-55` both deliberately consume AFTER those checks and comment on why; this file is the outlier.

Reorder the top of the handler to:

1. `requireAuth`
2. `getValidatedRouterParams`
3. `readValidatedBody`
4. **`sanitizePromptInput` → 400** (move it UP — it is pure string validation and needs no credit)
5. `requireTripAccess`
6. trip lookup → 404
7. day lookup → 404
8. **`tryConsumeAiCredit`** (last, after every rejection that can be known without the model)

Because sanitize now runs BEFORE the consume, its 400 no longer needs a refund — **delete the `await refundAiCredit(session.user.id)` line added for it in Phase 3**, and replace the block with:

```ts
// Sanitize before consuming: this is pure string validation, so a rejection
// here must never cost the traveler a credit. (Phase 3 added a refund here
// because the consume used to come first; moving the consume below every
// validation makes that refund unnecessary rather than merely correct.)
const prompt = sanitizePromptInput(rawPrompt)
if (!prompt) {
  throw createError({
    statusCode: 400,
    message:
      "Your prompt contains disallowed content. Please describe your travel preferences only.",
  })
}
```

Keep the 400's status and message byte-identical. Do not touch the `processUserRequest` catch's refund (Task 5 depends on it).

- [ ] **Step 3: Re-verify the whole file's refund enumeration**

This task MOVES a consume, so the file's accounting must be re-derived from scratch, not assumed. Enumerate every exit after `tryConsumeAiCredit` in your report and confirm: pre-consume throws → 0 refunds; the `processUserRequest` catch → exactly 1; success → 0; and no path fires 2. Confirm the sanitize-400 now sits BEFORE the consume and therefore refunds 0.

- [ ] **Step 4: Verify and commit**

```bash
bunx nuxi typecheck
bun test server/lib/
bun run check
git add server/utils/ai-limits.ts server/api/trips/\[id\]/days/\[dayId\]/ai.post.ts
git commit -m "fix(ai): consume the day-AI credit only after validation; correct refund docs"
```

---

### Task 7: Runtime verification

The spec REQUIRES this, and `bun test` cannot substitute: no unit test can observe whether bytes arrive incrementally or whether a client disconnect reaches the server. Steps 1-4 verify locally; **Step 5 is the preview-deploy check the spec mandates before this can be called done** ("The implementation plan must include a preview-deploy check of incremental delivery before this is called done"). Local dev is a plain Node server, NOT Vercel's Lambda streaming bridge — so local passes say nothing about bridge buffering, which is the one failure mode that would kill this feature outright in production while every test stays green.

**If the human waives Step 5**, that is their call — but then Step 6 must state plainly that buffering and disconnect-propagation are unverified on real infra, and the branch ships with that risk named.

**Files:** none (verification only — revert any probe edits).

**Local setup (verified recipe):**

- Docker postgres is already up: `ai_trip_dev-postgres-1` on 5437, wsproxy on 5433. Migrate if needed: `DATABASE_URL=postgresql://postgres:postgres@localhost:5437/ai_trip bunx drizzle-kit migrate`
- Dev server needs `DATABASE_URL=postgresql://postgres:postgres@localhost/ai_trip` (the wsproxy path is dev-only — `server/db/index.ts` gates it on `import.meta.dev`). Run `bun run dev`.
- Auth without OAuth: session cookie `ai-trip.session_token`, value = `encodeURIComponent(token + "." + base64(HMAC-SHA256(BETTER_AUTH_SECRET, token)))` (better-call's `signCookieValue`). Insert user+session rows via drizzle, set the cookie in playwright-core (chromium headless shell at `~/Library/Caches/ms-playwright/chromium_headless_shell-*`).
- If `/` 500s with ENOTDIR from the ISR payload cache: `rm -rf .nuxt/cache`.
- `.env` has a real `GOOGLE_GENERATIVE_AI_API_KEY` — real Gemini calls cost real quota. Keep probes to one or two short turns.

- [ ] **Step 1: Prove bytes arrive incrementally**

Send a discuss turn that forces tool use (e.g. "find me a good ramen place near Shinjuku and add it to day 1") and record the wall-clock arrival time of each SSE frame. Tool frames MUST land measurably before the `done` frame — if every frame arrives at once, the response is buffered and the feature is dead.
Report the actual timestamps.

- [ ] **Step 2: Prove live tool lines and streaming text in the browser**

Drive the chat headlessly, screenshot mid-turn, and confirm: tool lines appear while the agent works, text types in progressively, and the proposal cards appear only after the text. Report screenshot paths.

- [ ] **Step 3: Prove cancel aborts server-side**

Start a turn, hit Cancel mid-stream, and confirm from the server logs that the agent actually stopped (rather than running to completion). Then check `ai_usage.prompt_count`: cancelling BEFORE any token → refunded; cancelling AFTER text streamed → charged. Report both numbers.

- [ ] **Step 4: Prove the credit rule end-to-end**

Query `ai_usage.prompt_count` before/after: a normal successful turn charges exactly 1. Report both numbers.

- [ ] **Step 5: Preview-deploy check (spec-mandated — confirm with the human before deploying)**

This is the only step that can settle the two questions local dev structurally cannot. The project is already linked (`.vercel/project.json` → `ai-trip`) and the `vercel` CLI is on PATH.

**Deploying is outward-facing — get explicit confirmation from the human before running it.** Then:

```bash
vercel deploy            # PREVIEW, never --prod
```

Against the returned preview URL, with a valid session cookie:

1. **Buffering** — `curl -N` the discuss endpoint and timestamp each frame's arrival:
   ```bash
   curl -N -X POST "$PREVIEW_URL/api/trips/$TRIP_ID/discuss" \
     -H 'content-type: application/json' \
     -H "cookie: ai-trip.session_token=$COOKIE" \
     -d '{"messages":[{"role":"user","content":"find a ramen place near Shinjuku"}]}' \
     | while IFS= read -r line; do printf '%s %s\n' "$(date +%s.%N)" "$line"; done
   ```
   PASS = timestamps spread across the turn. FAIL = every frame lands at once → Vercel is buffering → stop and escalate; the spec's fallback is NDJSON over a raw `ReadableStream`.
2. **Disconnect propagation** — start a turn against the preview, kill the client mid-stream, and confirm from `vercel logs` that the agent aborted rather than running to completion.

Report the raw timestamps and the log evidence.

- [ ] **Step 6: Report what remains unverified**

State plainly in the report which of Step 5's two checks actually ran. If Step 5 was waived or a check could not be completed, say so explicitly — "Vercel bridge buffering and disconnect-propagation timing remain UNVERIFIED; local dev is a Node server, not the Lambda streaming bridge" — and name NDJSON as the fallback. Never claim these were verified when they were not.

- [ ] **Step 7: Confirm the tree is clean**

```bash
git status --short   # must show no leftover probe edits to product code
git diff             # must be empty
```

---

## Verification before done

- [ ] `bun test server/lib/discuss-stream.test.ts app/utils/sse-parse.test.ts` — pass
- [ ] `bun test` — full suite, no regressions
- [ ] `bun run check` — exits 0, no new warnings
- [ ] `bunx nuxi typecheck` — no new errors; no `any`, no gratuitous `as unknown as`
- [ ] `bun run build` — compiles (known ENAMETOOLONG trace failure at the end is a PASS)
- [ ] Credit audit: `grep -rn "refundAiCredit" server/` — every call site is either the single `refundOnce` guard in `discuss.post.ts` or the one `processUserRequest` catch in `ai.post.ts`. No handler can refund twice.
- [ ] Task 7's runtime evidence exists, including the honest statement of what remains unverified on Vercel
