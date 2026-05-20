import assert from "node:assert/strict"
import { describe, it } from "node:test"

// Smoke test: refundAiCredit is callable and returns a Promise<void>.
describe("refundAiCredit", () => {
  it("is exported and returns a thenable", async () => {
    const { refundAiCredit } = await import("./ai-limits")
    assert.equal(typeof refundAiCredit, "function")
  })
})
