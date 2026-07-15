import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildDaySnapshot } from "./useDayUndo"

describe("buildDaySnapshot", () => {
  it("maps loaded activities to the restore snapshot shape", () => {
    const snap = buildDaySnapshot([
      {
        name: "Marble Mountains",
        placeId: "p1",
        type: "attraction",
        description: "caves",
        lat: 16.0,
        lng: 108.2,
        address: "Da Nang",
        rating: "4.5",
        priceLevel: 2,
        openingHours: ["Mon 8-5"],
        photos: [],
        suggestedTime: "09:00",
        estimatedDurationMinutes: 90,
        costEstimate: "10",
        tags: ["nature"],
        sortOrder: 0,
        notes: null,
        actualCost: null,
        extraneous: "ignored",
      },
    ])
    assert.equal(snap.length, 1)
    assert.equal(snap[0]!.name, "Marble Mountains")
    assert.equal(snap[0]!.sortOrder, 0)
    assert.equal("extraneous" in snap[0]!, false)
  })
})
