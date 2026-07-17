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
