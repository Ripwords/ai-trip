import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { normalizeSuggestedTime, clampDurationMinutes } = await import("./normalize-ai-output")

describe("normalizeSuggestedTime", () => {
  it("zero-pads single-digit hours", () => {
    assert.equal(normalizeSuggestedTime("9:00"), "09:00")
  })

  it("keeps valid HH:MM unchanged", () => {
    assert.equal(normalizeSuggestedTime("09:00"), "09:00")
    assert.equal(normalizeSuggestedTime("23:59"), "23:59")
    assert.equal(normalizeSuggestedTime("00:00"), "00:00")
  })

  it("returns null for out-of-range or garbage values", () => {
    assert.equal(normalizeSuggestedTime("24:00"), null)
    assert.equal(normalizeSuggestedTime("9:99"), null)
    assert.equal(normalizeSuggestedTime("noon"), null)
    assert.equal(normalizeSuggestedTime(""), null)
    assert.equal(normalizeSuggestedTime(null), null)
    assert.equal(normalizeSuggestedTime(undefined), null)
  })
})

describe("clampDurationMinutes", () => {
  it("clamps into [5, 720]", () => {
    assert.equal(clampDurationMinutes(4), 5)
    assert.equal(clampDurationMinutes(721), 720)
    assert.equal(clampDurationMinutes(60), 60)
    assert.equal(clampDurationMinutes(5), 5)
    assert.equal(clampDurationMinutes(720), 720)
  })

  it("returns null for non-finite or missing values", () => {
    assert.equal(clampDurationMinutes(Number.NaN), null)
    assert.equal(clampDurationMinutes(null), null)
    assert.equal(clampDurationMinutes(undefined), null)
  })

  it("rounds fractional minutes", () => {
    assert.equal(clampDurationMinutes(90.6), 91)
  })
})
