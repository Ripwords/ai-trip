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

describe("mapChunk reasoning deltas", () => {
  it("surfaces a reasoning delta as a thinking event", () => {
    // Until now mapChunk returned null for every non-text, non-tool chunk, so
    // thinking mode produced a long silence and looked like a hang. This event
    // is the entire reason the 8x-slower mode is usable.
    assert.deepEqual(
      mapChunk({ type: "reasoning-delta", payload: { text: "Checking the hotel's side of town" } }),
      { type: "thinking", delta: "Checking the hotel's side of town" },
    )
  })

  it("drops zero-length reasoning deltas, matching text-delta behaviour", () => {
    assert.equal(mapChunk({ type: "reasoning-delta", payload: { text: "" } }), null)
  })

  it("drops a malformed reasoning payload rather than throwing", () => {
    assert.equal(mapChunk({ type: "reasoning-delta", payload: null }), null)
    assert.equal(mapChunk({ type: "reasoning-delta", payload: { text: 42 } }), null)
    assert.equal(mapChunk({ type: "reasoning-delta" }), null)
  })

  it("still ignores chunk types it does not know", () => {
    assert.equal(mapChunk({ type: "step-finish", payload: {} }), null)
    assert.equal(mapChunk({ type: "finish", payload: {} }), null)
  })

  it("keeps text and reasoning in separate channels", () => {
    // A reasoning delta must never be appended to the reply body — it is not
    // the assistant's answer and is deliberately not persisted.
    const reasoning = mapChunk({ type: "reasoning-delta", payload: { text: "hmm" } })
    const text = mapChunk({ type: "text-delta", payload: { text: "hmm" } })
    assert.notDeepEqual(reasoning, text)
  })
})
