import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import { getModel } from "./ai-config"

const originalKey = process.env.DEEPSEEK_API_KEY

function setKey() {
  process.env.DEEPSEEK_API_KEY = "test-key"
}

function unsetKey() {
  delete process.env.DEEPSEEK_API_KEY
}

describe("getModel", () => {
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = originalKey
  })

  describe("grounding-locked keys stay on Gemini regardless of env", () => {
    it("research resolves to gemini-3.1-flash-lite with DEEPSEEK_API_KEY set", () => {
      setKey()
      const model = getModel("research")
      assert.equal(model.modelId, "gemini-3.1-flash-lite")
      assert.match(model.provider, /google/)
    })

    it("research resolves to gemini-3.1-flash-lite without DEEPSEEK_API_KEY", () => {
      unsetKey()
      const model = getModel("research")
      assert.equal(model.modelId, "gemini-3.1-flash-lite")
      assert.match(model.provider, /google/)
    })

    it("classify resolves to gemini-3.1-flash-lite with DEEPSEEK_API_KEY set", () => {
      setKey()
      const model = getModel("classify")
      assert.equal(model.modelId, "gemini-3.1-flash-lite")
      assert.match(model.provider, /google/)
    })

    it("classify resolves to gemini-3.1-flash-lite without DEEPSEEK_API_KEY", () => {
      unsetKey()
      const model = getModel("classify")
      assert.equal(model.modelId, "gemini-3.1-flash-lite")
      assert.match(model.provider, /google/)
    })
  })

  // DeepSeek was reverted (too slow for the interactive discuss chat and for
  // generateObject latency) — default/discuss run on Gemini regardless of the
  // key. The DeepSeek plumbing stays in getModel as a one-line re-enable lever.
  describe("default and discuss run on gemini-3.5-flash", () => {
    it("default resolves to gemini-3.5-flash with DEEPSEEK_API_KEY set", () => {
      setKey()
      const model = getModel()
      assert.equal(model.modelId, "gemini-3.5-flash")
      assert.match(model.provider, /google/)
    })

    it("default resolves to gemini-3.5-flash without DEEPSEEK_API_KEY", () => {
      unsetKey()
      const model = getModel()
      assert.equal(model.modelId, "gemini-3.5-flash")
      assert.match(model.provider, /google/)
    })

    it("discuss resolves to gemini-3.5-flash with DEEPSEEK_API_KEY set", () => {
      setKey()
      const model = getModel("discuss")
      assert.equal(model.modelId, "gemini-3.5-flash")
      assert.match(model.provider, /google/)
    })

    it("discuss resolves to gemini-3.5-flash without DEEPSEEK_API_KEY", () => {
      unsetKey()
      const model = getModel("discuss")
      assert.equal(model.modelId, "gemini-3.5-flash")
      assert.match(model.provider, /google/)
    })
  })
})
