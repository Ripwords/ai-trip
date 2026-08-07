import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { withOneRetry, withTimeout } = await import("./retry")

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

describe("withTimeout", () => {
  it("passes the resolved value through when the work finishes in time", async () => {
    assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "fast"), "ok")
  })

  it("rejects with a labelled TimeoutError once the budget is spent", async () => {
    // The point is NOT to cancel the underlying work — an in-flight model call
    // cannot be recalled. It is to hand control back to the handler while the
    // function is still alive, so the refund runs. Vercel killing the process
    // mid-call skips the catch block entirely and bills for nothing.
    const never = new Promise<string>(() => {})
    await assert.rejects(() => withTimeout(never, 20, "generation"), /generation.*timed out/i)
  })

  it("does not reject work that finishes just inside the budget", async () => {
    const soon = new Promise<string>((resolve) => setTimeout(() => resolve("just made it"), 5))
    assert.equal(await withTimeout(soon, 200, "generation"), "just made it")
  })

  it("propagates the original rejection rather than masking it as a timeout", async () => {
    // A real model failure must surface as itself; swallowing it into a generic
    // timeout would send the traveler a misleading error and hide the cause.
    const boom = Promise.reject(new Error("provider exploded"))
    await assert.rejects(() => withTimeout(boom, 1000, "generation"), /provider exploded/)
  })

  it("clears its timer so a fast result cannot keep the process alive", async () => {
    // A dangling setTimeout holds the event loop open, which on a serverless
    // function means paying for idle wall-clock after the response is sent.
    const before = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0
    await withTimeout(Promise.resolve("done"), 60_000, "fast")
    const after = process.getActiveResourcesInfo?.().filter((r) => r === "Timeout").length ?? 0
    assert.equal(after, before, "the 60s timer must be cleared, not left pending")
  })
})
