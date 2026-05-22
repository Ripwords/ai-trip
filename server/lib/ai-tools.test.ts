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

  it("proposeAddActivities pushes a valid proposal using the active day id", async () => {
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
    assert.equal(collector[0]?.dayId, "22222222-2222-4222-8222-222222222222")
  })

  it("proposeAddActivities refuses when no active day is set in ctx", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(
      {
        tripId: "55555555-5555-4555-8555-555555555555",
        dayId: "",
        transportMode: "walking",
        currencyCode: "USD",
      },
      collector,
    )
    const result = await tools.proposeAddActivities.execute({
      summary: "Add something",
      activities: [
        {
          name: "Cafe",
          type: "cafe",
          description: "",
          suggestedTime: "10:00",
          estimatedDurationMinutes: 30,
          costEstimate: 5,
          tags: [],
        },
      ],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })

  it("proposeReorder refuses when no active day is set in ctx", async () => {
    const collector: Proposal[] = []
    const tools = createDiscussTools(
      {
        tripId: "55555555-5555-4555-8555-555555555555",
        dayId: "",
        transportMode: "walking",
        currencyCode: "USD",
      },
      collector,
    )
    const result = await tools.proposeReorder.execute({
      summary: "Reorder",
      orderedActivityIds: ["33333333-3333-4333-8333-333333333333"],
    })
    assert.equal(result.ok, false)
    assert.equal(collector.length, 0)
  })

  it("proposeReschedule rejects an invalid time format", async () => {
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
    // Activity-id validation will fail first (no db row) — this is the right
    // behaviour: hallucinated ids must not produce a no-op proposal.
    const result = await tools.proposeReschedule.execute({
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
