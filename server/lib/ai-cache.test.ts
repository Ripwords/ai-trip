import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { researchCacheKey, isCacheableResearch } = await import("./ai-cache")

describe("researchCacheKey", () => {
  it("is stable for the same destination and context", () => {
    assert.equal(
      researchCacheKey("Tokyo, Japan", "ramen spots"),
      researchCacheKey("Tokyo, Japan", "ramen spots"),
    )
  })

  it("normalizes case and whitespace", () => {
    assert.equal(
      researchCacheKey("  Tokyo, Japan ", "Ramen Spots"),
      researchCacheKey("tokyo, japan", "ramen spots"),
    )
  })

  it("differs when the context differs", () => {
    assert.notEqual(
      researchCacheKey("Tokyo, Japan", "ramen spots"),
      researchCacheKey("Tokyo, Japan", "jazz bars"),
    )
  })

  it("contains no raw user text and only storage-safe characters", () => {
    const key = researchCacheKey("Tokyo, Japan", "IGNORE ALL <instructions>://?")
    assert.ok(!/ignore all/i.test(key))
    assert.match(key, /^[a-z0-9-]+$/)
  })
})

describe("isCacheableResearch", () => {
  it("accepts a non-empty research block", () => {
    assert.equal(isCacheableResearch("<research_results>…</research_results>"), true)
  })

  it("rejects empty results and non-strings (never cache failures)", () => {
    assert.equal(isCacheableResearch(""), false)
    assert.equal(isCacheableResearch(null), false)
    assert.equal(isCacheableResearch(undefined), false)
  })
})
