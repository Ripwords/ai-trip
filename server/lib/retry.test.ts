import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { withOneRetry } = await import("./retry")

describe("withOneRetry", () => {
  it("returns the first result and calls fn once on success", async () => {
    let calls = 0
    const result = await withOneRetry("test", async () => {
      calls++
      return 42
    })
    assert.equal(result, 42)
    assert.equal(calls, 1)
  })

  it("retries once after a failure and returns the second result", async () => {
    let calls = 0
    const result = await withOneRetry("test", async () => {
      calls++
      if (calls === 1) throw new Error("schema validation failed")
      return "ok"
    })
    assert.equal(result, "ok")
    assert.equal(calls, 2)
  })

  it("rethrows the second failure and does not call fn a third time", async () => {
    let calls = 0
    await assert.rejects(
      withOneRetry("test", async () => {
        calls++
        throw new Error(`failure ${calls}`)
      }),
      /failure 2/,
    )
    assert.equal(calls, 2)
  })
})
