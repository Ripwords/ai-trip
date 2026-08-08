/**
 * Pure mapping from Mastra stream chunks to the discuss endpoint's SSE events.
 *
 * `describeToolCall` lives here (rather than in the endpoint) so the LIVE tool
 * line and the persisted `toolCallSummary` are produced by one implementation
 * and can never drift apart.
 */

// `DiscussSseEvent` lives in shared/utils/discuss-sse.ts (not here) so the
// client can import the wire contract via Nuxt's `#shared` alias instead of
// reaching directly into server/. This file stays free of RUNTIME imports —
// `import type` is erased at compile time, so referencing the type below
// costs nothing at runtime and keeps this module unit-testable with plain
// object literals. See shared/utils/discuss-sse.ts for the full contract
// and the Proposal-typing tradeoff.
import type { DiscussSseEvent } from "../../shared/utils/discuss-sse"

/** Build an h3 `EventStreamMessage`-shaped frame from a typed event. */
export function toSseFrame(e: DiscussSseEvent): { event: DiscussSseEvent["event"]; data: string } {
  return { event: e.event, data: JSON.stringify(e.data) }
}

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
 * Structural shape of an AI SDK `fullStream` chunk. Typed structurally rather
 * than importing the SDK's deep chunk union: this keeps the mapper unit-testable
 * with plain object literals and independent of the SDK's internal type layout.
 *
 * Chunks are FLAT. Under Mastra they were wrapped (`chunk.payload.text`); the
 * AI SDK puts the content directly on the chunk, and renames `tool-call`'s
 * `args` to `input`. Verified against the live API — see the shapes in
 * .superpowers/probe-chunks.ts.
 */
export interface StreamChunkLike {
  type: string
  /** `text-delta` / `reasoning-delta` carry their content here. */
  text?: unknown
  /** `tool-call` carries the tool's name here. */
  toolName?: unknown
  /** `tool-call` carries the parsed arguments here (was `args` under Mastra). */
  input?: unknown
  /**
   * Real chunks carry more than the mapper reads — `id`, `toolCallId`,
   * `providerMetadata`, usage totals. Accepted and ignored, so a test literal
   * can mirror an actual chunk without the type rejecting the extra keys.
   */
  [key: string]: unknown
}

export type DiscussStreamEvent =
  | { type: "tool"; line: string }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }

function asToolCallPayload(
  c: StreamChunkLike,
): { toolName: string; args?: Record<string, unknown> } | null {
  if (typeof c.toolName !== "string") return null
  const safeArgs =
    typeof c.input === "object" && c.input !== null
      ? (c.input as Record<string, unknown>)
      : undefined
  return { toolName: c.toolName, args: safeArgs }
}

function asTextPayload(c: StreamChunkLike): { text: string } | null {
  return typeof c.text === "string" ? { text: c.text } : null
}

/**
 * Map one chunk to an outbound event, or null if it carries nothing the user
 * should see. Only `tool-call` (fires BEFORE the tool runs, so the line can say
 * what is happening now), `text-delta`, and `reasoning-delta` are surfaced.
 */
export function mapChunk(chunk: StreamChunkLike): DiscussStreamEvent | null {
  if (chunk.type === "tool-call") {
    const payload = asToolCallPayload(chunk)
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
    const payload = asTextPayload(chunk)
    if (!payload || payload.text.length === 0) return null
    return { type: "text", delta: payload.text }
  }

  // Reasoning content from DeepSeek thinking mode. Surfaced live but NEVER
  // persisted and never counted as delivered value — see discuss.post.ts.
  if (chunk.type === "reasoning-delta") {
    const payload = asTextPayload(chunk)
    if (!payload || payload.text.length === 0) return null
    return { type: "thinking", delta: payload.text }
  }

  return null
}
