import assert from "node:assert/strict"
import { describe, it } from "node:test"

const {
  researchCacheKey,
  isCacheableResearch,
  timeOfDayBucket,
  layoverTipsCacheKey,
  researchIntent,
  normalizeResearchDestination,
} = await import("./ai-cache")

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

describe("normalizeResearchDestination", () => {
  it("collapses a per-day street address to its city and country", () => {
    assert.equal(
      normalizeResearchDestination("1-1 Yoyogikamizonocho, Shibuya City, Tokyo 151-8557, Japan"),
      "tokyo, japan",
    )
    assert.equal(normalizeResearchDestination("Tokyo, Japan"), "tokyo, japan")
  })

  it("keeps single-segment destinations intact", () => {
    assert.equal(normalizeResearchDestination("Tokyo"), "tokyo")
  })

  it("falls back to the raw input when normalization strips everything", () => {
    assert.equal(normalizeResearchDestination("151-8557"), "151-8557")
    assert.equal(normalizeResearchDestination("   "), "")
  })
})

describe("researchIntent", () => {
  it("buckets prompts by the topic that actually determines the research", () => {
    assert.equal(researchIntent("find me some great ramen spots"), "food")
    assert.equal(researchIntent("jazz bars and cocktails after dinner"), "nightlife")
    assert.equal(researchIntent("hotels accommodation airbnb near the station"), "accommodation")
    assert.equal(researchIntent("temples and museums to visit"), "attractions")
    assert.equal(researchIntent("a day hike with mountain views"), "outdoors")
    assert.equal(researchIntent("souvenir shopping and markets"), "shopping")
  })

  it("falls back to general when nothing matches", () => {
    assert.equal(researchIntent(""), "general")
    assert.equal(researchIntent(undefined), "general")
    assert.equal(researchIntent("just do something nice"), "general")
  })

  it("is stable regardless of phrasing or case", () => {
    assert.equal(researchIntent("Where should we EAT lunch?"), researchIntent("good lunch places"))
  })
})

describe("researchCacheKey normalization (issue #31)", () => {
  it("hits across differently-worded prompts with the same intent", () => {
    assert.equal(
      researchCacheKey("Tokyo, Japan", "find a great dinner spot for day 2"),
      researchCacheKey("Tokyo, Japan", "somewhere authentic to eat on our last night"),
    )
  })

  it("hits across per-day street addresses in the same city", () => {
    assert.equal(
      researchCacheKey("1-1 Yoyogikamizonocho, Shibuya City, Tokyo 151-8557, Japan", "ramen"),
      researchCacheKey("2-8-1 Nishishinjuku, Shinjuku City, Tokyo 163-8001, Japan", "ramen"),
    )
  })

  it("still misses across different cities and different intents", () => {
    assert.notEqual(
      researchCacheKey("Tokyo, Japan", "ramen spots"),
      researchCacheKey("Osaka, Japan", "ramen spots"),
    )
    assert.notEqual(
      researchCacheKey("Tokyo, Japan", "ramen spots"),
      researchCacheKey("Tokyo, Japan", "where to stay"),
    )
  })
})

describe("timeOfDayBucket", () => {
  it("buckets the local clock hour, not the server timezone", () => {
    assert.equal(timeOfDayBucket("2026-08-04T03:00:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T09:30:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T12:00:00"), "afternoon")
    assert.equal(timeOfDayBucket("2026-08-04T19:45:00"), "evening")
  })

  it("covers every boundary hour exactly once", () => {
    assert.equal(timeOfDayBucket("2026-08-04T00:00:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T05:59:00"), "night")
    assert.equal(timeOfDayBucket("2026-08-04T06:00:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T11:59:00"), "morning")
    assert.equal(timeOfDayBucket("2026-08-04T17:59:00"), "afternoon")
    assert.equal(timeOfDayBucket("2026-08-04T18:00:00"), "evening")
    assert.equal(timeOfDayBucket("2026-08-04T23:59:00"), "evening")
  })

  it("returns unknown for null or unparseable input", () => {
    assert.equal(timeOfDayBucket(null), "unknown")
    assert.equal(timeOfDayBucket("not a date"), "unknown")
  })
})

describe("layoverTipsCacheKey", () => {
  it("distinguishes arrivals at different times of day (issue #15)", () => {
    assert.notEqual(
      layoverTipsCacheKey("SIN", 6, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 6, "visa_free", "afternoon"),
    )
  })

  it("is stable for the same inputs", () => {
    assert.equal(
      layoverTipsCacheKey("SIN", 6, "visa_free", "night"),
      layoverTipsCacheKey("SIN", 6, "visa_free", "night"),
    )
  })

  it("still distinguishes airport, duration and visa status", () => {
    const base = layoverTipsCacheKey("SIN", 6, "visa_free", "night")
    assert.notEqual(base, layoverTipsCacheKey("HND", 6, "visa_free", "night"))
    assert.notEqual(base, layoverTipsCacheKey("SIN", 7, "visa_free", "night"))
    assert.notEqual(base, layoverTipsCacheKey("SIN", 6, "visa_required", "night"))
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
