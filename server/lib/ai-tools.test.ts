import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createTripTools, createDiscussTools } from "./ai-tools"
import type { Proposal } from "./proposals"

describe("createTripTools", () => {
  it("returns the expected tool ids", () => {
    const tools = createTripTools({
      tripId: "55555555-5555-4555-8555-555555555555",
      dayId: "22222222-2222-4222-8222-222222222222",
      transportMode: "walking",
      currencyCode: "USD",
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

describe("createDiscussTools", () => {
  it("returns the expected tool ids including web_search and propose_*", () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(
      {
        tripId: "55555555-5555-4555-8555-555555555555",
        dayId: "22222222-2222-4222-8222-222222222222",
        transportMode: "walking",
        currencyCode: "USD",
      },
      collector,
    )
    const ids = Object.keys(tools).toSorted()
    assert.deepEqual(ids, [
      "getDistance",
      "getPlaceDetails",
      "proposeAddActivities",
      "proposeRemoveActivities",
      "proposeReorder",
      "proposeReschedule",
      "proposeSetAccommodation",
      "readDay",
      "readTripSummary",
      "runReview",
      "searchPlaces",
      "webSearch",
    ])
  })

  it("propose_add_activities pushes a valid proposal to the collector", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(
      {
        tripId: "55555555-5555-4555-8555-555555555555",
        dayId: "22222222-2222-4222-8222-222222222222",
        transportMode: "walking",
        currencyCode: "USD",
      },
      collector,
    )
    const result = await tools.proposeAddActivities.execute({
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Add Afuri Ramen at 12:30",
      activities: [
        {
          name: "Afuri Ramen",
          type: "restaurant",
          description: "yuzu shio",
          suggestedTime: "12:30",
          estimatedDurationMinutes: 60,
          costEstimate: 15,
          tags: ["lunch"],
        },
      ],
    })
    assert.equal(result.ok, true)
    assert.equal(collector.length, 1)
    assert.equal(collector[0]?.kind, "add-activities")
  })

  it("propose_reorder pushes a reorder proposal to the collector", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(
      {
        tripId: "55555555-5555-4555-8555-555555555555",
        dayId: "22222222-2222-4222-8222-222222222222",
        transportMode: "walking",
        currencyCode: "USD",
      },
      collector,
    )
    const result = await tools.proposeReorder.execute({
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Put the museum before the castle",
      orderedActivityIds: [
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
      ],
    })
    assert.equal(result.ok, true)
    assert.equal(collector.length, 1)
    assert.equal(collector[0]?.kind, "reorder-activities")
  })

  it("propose_reschedule rejects an invalid time format", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(
      {
        tripId: "55555555-5555-4555-8555-555555555555",
        dayId: "22222222-2222-4222-8222-222222222222",
        transportMode: "walking",
        currencyCode: "USD",
      },
      collector,
    )
    const result = await tools.proposeReschedule.execute({
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Reschedule",
      updates: [
        {
          activityId: "33333333-3333-4333-8333-333333333333",
          suggestedTime: "7pm",
          estimatedDurationMinutes: 60,
        },
      ],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })
})
