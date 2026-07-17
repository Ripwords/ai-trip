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
