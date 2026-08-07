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

describe("provider options reach the model", () => {
  it("keeps thinking disabled by default in the shared constant", () => {
    // The whole point of AI_PROVIDER_OPTIONS: DeepSeek V4 defaults to a hidden
    // reasoning phase. If this constant is ever passed somewhere the runtime
    // does not read, thinking is silently ON everywhere it is relied upon.
    assert.deepEqual(AI_PROVIDER_OPTIONS, { deepseek: { thinking: { type: "disabled" } } })
  })

  it("no agent constructor carries providerOptions", async () => {
    // Regression guard for the pre-flight finding: AgentConfig has no such
    // field, so a constructor-level value is dropped at runtime AND fails
    // typecheck. Provider options must be passed per call instead.
    const files = [
      "server/lib/discuss-agent.ts",
      "server/lib/itinerary-review-ai.ts",
      "server/lib/ai.ts",
    ]
    const { readFile } = await import("node:fs/promises")
    for (const f of files) {
      const src = await readFile(new URL(`../../${f}`, import.meta.url), "utf8")
      // Match `providerOptions` appearing inside a `new Agent({ ... })` literal.
      const agentBlocks = src.match(/new Agent\(\{[\s\S]*?\n\s*\}\)/g) ?? []
      for (const block of agentBlocks) {
        assert.ok(
          !block.includes("providerOptions"),
          `${f}: new Agent({...}) must not set providerOptions — AgentConfig has no such field, so it is dropped`,
        )
      }
    }
  })
})
