import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { normalizeSuggestedTime, clampDurationMinutes, mapOrderedActivityIndexes } =
  await import("./normalize-ai-output")

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

describe("mapOrderedActivityIndexes", () => {
  const activities = [
    { id: "id-a", name: "Bếp Cuốn Đà Nẵng" },
    { id: "id-b", name: "Dragon Bridge Fire & Water Show (Cầu Rồng)" },
    { id: "id-c", name: "Ha My Beach" },
  ]

  it("maps AI-returned indexes to activity ids in the given order", () => {
    const mapped = mapOrderedActivityIndexes(
      [
        { index: 2, suggestedTime: "10:00" },
        { index: 0, suggestedTime: "19:30" },
        { index: 1, suggestedTime: "21:00" },
      ],
      activities,
    )

    assert.deepEqual(mapped, [
      { id: "id-c", name: "Ha My Beach", suggestedTime: "10:00" },
      { id: "id-a", name: "Bếp Cuốn Đà Nẵng", suggestedTime: "19:30" },
      { id: "id-b", name: "Dragon Bridge Fire & Water Show (Cầu Rồng)", suggestedTime: "21:00" },
    ])
  })

  it("drops out-of-range and non-integer indexes", () => {
    const mapped = mapOrderedActivityIndexes(
      [
        { index: 5, suggestedTime: "10:00" },
        { index: -1, suggestedTime: "11:00" },
        { index: 1.5, suggestedTime: "12:00" },
        { index: 1, suggestedTime: "13:00" },
      ],
      activities,
    )

    assert.deepEqual(
      mapped.map((m) => m.id),
      ["id-b"],
    )
  })

  it("keeps only the first entry when the AI repeats an index", () => {
    const mapped = mapOrderedActivityIndexes(
      [
        { index: 0, suggestedTime: "09:00" },
        { index: 0, suggestedTime: "18:00" },
      ],
      activities,
    )

    assert.deepEqual(mapped, [{ id: "id-a", name: "Bếp Cuốn Đà Nẵng", suggestedTime: "09:00" }])
  })
})
