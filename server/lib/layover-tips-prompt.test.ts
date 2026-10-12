import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { layoverTipsCacheKey } from "./ai-cache"
import { buildLayoverTipsPrompt, layoverTipsBodySchema } from "./layover-tips-prompt"

const base = { airport: "SIN", visaStatus: "visa_free", timeOfDay: "night" }

describe("layover tips with an unknown connection length (B20)", () => {
  it("accepts a request that says the length is unknown, or leaves it out", () => {
    const sent = layoverTipsBodySchema.parse({ ...base, durationMinutes: null })
    assert.equal(sent.durationMinutes, null)
    const omitted = layoverTipsBodySchema.parse({ airport: "SIN", visaStatus: null })
    assert.equal(omitted.durationMinutes ?? null, null)
  })

  it("still rejects a length that is present but not a positive whole number", () => {
    assert.throws(() => layoverTipsBodySchema.parse({ ...base, durationMinutes: 0 }))
    assert.throws(() => layoverTipsBodySchema.parse({ ...base, durationMinutes: 12.5 }))
  })

  it("tells the model the length is unknown instead of inventing one", () => {
    const prompt = buildLayoverTipsPrompt({ ...base, durationMinutes: null })
    assert.match(prompt, /unknown length/i)
    assert.doesNotMatch(prompt, /3-hour|180/)
    assert.match(prompt, /check the connection time/i)
  })

  it("keeps the exact length and the short-layover rule when it is known", () => {
    const prompt = buildLayoverTipsPrompt({ ...base, durationMinutes: 45 })
    assert.match(prompt, /45-minute layover at SIN/)
    assert.match(prompt, /in-airport options only/)
    assert.doesNotMatch(prompt, /unknown length/i)
  })

  it("caches an unknown length apart from every known one", () => {
    const unknown = layoverTipsCacheKey("SIN", null, "visa_free", "night")
    for (const minutes of [1, 30, 180, 360]) {
      assert.notEqual(unknown, layoverTipsCacheKey("SIN", minutes, "visa_free", "night"))
    }
  })
})
