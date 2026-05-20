import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createTripTools } from "./ai-tools"

describe("createTripTools", () => {
  it("returns the expected tool ids", () => {
    const tools = createTripTools({
      tripId: "55555555-5555-4555-8555-555555555555",
      dayId: "22222222-2222-4222-8222-222222222222",
      transportMode: "walking",
    })
    const ids = Object.keys(tools).toSorted()
    assert.deepEqual(ids, [
      "getDistance",
      "getPlaceDetails",
      "readDay",
      "readTripSummary",
      "runReview",
      "searchPlaces",
    ])
  })
})
