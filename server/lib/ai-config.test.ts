import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import { getModel, AI_PROVIDER_OPTIONS, aiProviderOptions, thinkingAvailable } from "./ai-config"

const originalKey = process.env.DEEPSEEK_API_KEY

function setKey() {
  process.env.DEEPSEEK_API_KEY = "test-key"
}

function unsetKey() {
  delete process.env.DEEPSEEK_API_KEY
}

describe("AI_PROVIDER_OPTIONS", () => {
  it("disables DeepSeek thinking mode", () => {
    assert.equal(AI_PROVIDER_OPTIONS.deepseek.thinking.type, "disabled")
  })

  it("is namespaced under deepseek only (no-op for Gemini)", () => {
    assert.deepEqual(Object.keys(AI_PROVIDER_OPTIONS), ["deepseek"])
  })
})

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

  // DeepSeek runs in non-thinking mode (AI_PROVIDER_OPTIONS) — verified ~8x
  // faster than the thinking default. default/discuss route to it when the key
  // is present, and fall back to Gemini when it is not.
  describe("with DEEPSEEK_API_KEY set", () => {
    it("default resolves to deepseek-v4-flash", () => {
      setKey()
      const model = getModel()
      assert.equal(model.modelId, "deepseek-v4-flash")
      assert.match(model.provider, /deepseek/)
    })

    it("discuss resolves to deepseek-v4-flash", () => {
      setKey()
      const model = getModel("discuss")
      assert.equal(model.modelId, "deepseek-v4-flash")
      assert.match(model.provider, /deepseek/)
    })
  })

  describe("without DEEPSEEK_API_KEY", () => {
    it("default falls back to gemini-3.5-flash", () => {
      unsetKey()
      const model = getModel()
      assert.equal(model.modelId, "gemini-3.5-flash")
      assert.match(model.provider, /google/)
    })

    it("discuss falls back to gemini-3.5-flash", () => {
      unsetKey()
      const model = getModel("discuss")
      assert.equal(model.modelId, "gemini-3.5-flash")
      assert.match(model.provider, /google/)
    })
  })
})

describe("aiProviderOptions", () => {
  it("disables thinking in normal mode, matching the long-standing default", () => {
    // DeepSeek V4 defaults to thinking ON. Everything outside the opt-in path
    // depends on it being explicitly off.
    assert.deepEqual(aiProviderOptions(false), {
      deepseek: { thinking: { type: "disabled" } },
    })
  })

  it("enables thinking with an explicit reasoning effort in thinking mode", () => {
    assert.deepEqual(aiProviderOptions(true), {
      deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    })
  })

  it("namespaces everything under `deepseek` so Gemini call sites ignore it", () => {
    // getModel falls back to Gemini without DEEPSEEK_API_KEY. A stray top-level
    // key would reach that provider and could throw on an unknown option.
    assert.deepEqual(Object.keys(aiProviderOptions(true)), ["deepseek"])
    assert.deepEqual(Object.keys(aiProviderOptions(false)), ["deepseek"])
  })

  it("agrees with the AI_PROVIDER_OPTIONS constant in normal mode", () => {
    assert.deepEqual(aiProviderOptions(false), AI_PROVIDER_OPTIONS)
  })
})

describe("thinkingAvailable", () => {
  it("is false without a DeepSeek key, because the Gemini fallback cannot think", () => {
    // getModel silently returns a Gemini model when the key is missing, and
    // Gemini ignores deepseek-namespaced options entirely. Charging 3x for a
    // request that provably never reasoned is the bug this guards.
    const prev = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    try {
      assert.equal(thinkingAvailable(), false)
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev
    }
  })

  it("is true when a DeepSeek key is configured", () => {
    const prev = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = "test-key"
    try {
      assert.equal(thinkingAvailable(), true)
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = prev
    }
  })
})
