import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildPartySizeCtx, clampPartySize, PARTY_SIZE_MAX, resolvePartySize } from "./party-size"

describe("clampPartySize", () => {
  it("accepts a plain headcount", () => {
    assert.equal(clampPartySize(1), 1)
    assert.equal(clampPartySize(4), 4)
  })

  it("treats null, undefined and non-finite values as unset", () => {
    assert.equal(clampPartySize(null), null)
    assert.equal(clampPartySize(undefined), null)
    assert.equal(clampPartySize(NaN), null)
    assert.equal(clampPartySize(Infinity), null)
  })

  it("rejects zero and negatives rather than clamping them up to 1", () => {
    assert.equal(clampPartySize(0), null)
    assert.equal(clampPartySize(-3), null)
  })

  it("rounds fractions down", () => {
    assert.equal(clampPartySize(2.9), 2)
  })

  // preferences is jsonb — a row written outside the validated endpoints can
  // hold anything, and "1000000000 travelers" in a prompt is worse than none.
  it("clamps absurd values to the supported maximum", () => {
    assert.equal(clampPartySize(1e9), PARTY_SIZE_MAX)
  })
})

describe("resolvePartySize", () => {
  it("prefers the traveler's explicit setting over the member count", () => {
    assert.deepEqual(resolvePartySize({ partySize: 3, memberCount: 5 }), {
      size: 3,
      source: "setting",
    })
  })

  it("falls back to the member count when no setting is stored", () => {
    assert.deepEqual(resolvePartySize({ memberCount: 4 }), { size: 4, source: "members" })
  })

  // The whole point of the feature: a lone owner is the default state of every
  // solo-planned trip and says nothing about who is actually going. Reading it
  // as "1 traveler" would swap one silent guess for another.
  it("does not read a lone owner as a party of one", () => {
    assert.deepEqual(resolvePartySize({ memberCount: 1 }), { size: null, source: "unknown" })
  })

  it("reports unknown when neither source has anything", () => {
    assert.deepEqual(resolvePartySize({}), { size: null, source: "unknown" })
    assert.deepEqual(resolvePartySize({ partySize: null, memberCount: null }), {
      size: null,
      source: "unknown",
    })
  })

  it("ignores an unusable stored setting and falls through to members", () => {
    assert.deepEqual(resolvePartySize({ partySize: 0, memberCount: 2 }), {
      size: 2,
      source: "members",
    })
  })
})

describe("buildPartySizeCtx", () => {
  it("states an explicit setting as fact", () => {
    const ctx = buildPartySizeCtx({ size: 4, source: "setting" })
    assert.match(ctx, /4 travelers/)
    assert.match(ctx, /hard fact/)
  })

  it("uses the singular for a solo traveler", () => {
    assert.match(buildPartySizeCtx({ size: 1, source: "setting" }), /1 traveler\b/)
  })

  it("marks a member-count size as inferred", () => {
    const ctx = buildPartySizeCtx({ size: 2, source: "members" })
    assert.match(ctx, /2 travelers/)
    assert.match(ctx, /inferred/)
  })

  // costEstimate is per-person everywhere else (deriveCostFromPlace writes
  // Google's per-person price range straight into it), so a known party size
  // must not become a licence to multiply it.
  it("keeps per-activity cost estimates per person", () => {
    assert.match(buildPartySizeCtx({ size: 3, source: "setting" }), /PER PERSON/)
  })

  it("says nothing on an unknown size by default", () => {
    assert.equal(buildPartySizeCtx({ size: null, source: "unknown" }), "")
  })

  // The production defect: the chat quoted a cash budget "for two" on a trip
  // that never recorded a party size, and owned up only when asked.
  it("asks the model to name its assumption when guiding on an unknown size", () => {
    const ctx = buildPartySizeCtx({ size: null, source: "unknown" }, { guideWhenUnknown: true })
    assert.match(ctx, /not recorded/)
    assert.match(ctx, /assuming/)
  })
})
