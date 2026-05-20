import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { proposalSchema } from "./proposals"

describe("proposalSchema", () => {
  it("accepts an add-activities proposal with a valid payload", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "add-activities",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Add Afuri Ramen at 12:30",
      payload: {
        activities: [
          {
            name: "Afuri Ramen",
            type: "restaurant",
            description: "Yuzu shio ramen",
            suggestedTime: "12:30",
            estimatedDurationMinutes: 60,
            costEstimate: 15,
            tags: ["ramen", "lunch"],
          },
        ],
      },
    })
    assert.equal(result.success, true)
  })

  it("rejects an unknown kind", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "delete-day",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Delete day",
      payload: {},
    })
    assert.equal(result.success, false)
  })

  it("accepts a reschedule proposal with multiple updates", () => {
    const result = proposalSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "reschedule",
      dayId: "22222222-2222-4222-8222-222222222222",
      summary: "Move dinner later",
      payload: {
        updates: [
          {
            activityId: "33333333-3333-4333-8333-333333333333",
            suggestedTime: "19:00",
            estimatedDurationMinutes: 90,
          },
        ],
      },
    })
    assert.equal(result.success, true)
  })
})
