import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mergeFindings } from "./itinerary-review-ai"
import type { ItineraryReviewFinding } from "./itinerary-review"

const det: ItineraryReviewFinding = {
  id: "d1:missing-lunch:day",
  code: "missing-lunch",
  severity: "suggestion",
  title: "Lunch missing",
  message: "Day 1 lacks a lunch",
  recommendation: "Add a midday meal",
  dayId: "d1",
  dayNumber: 1,
}

const jud: ItineraryReviewFinding = {
  id: "d1:pace-mismatch:day",
  code: "pace-mismatch",
  severity: "warning",
  title: "Pace mismatch",
  message: "Too many stops",
  recommendation: "Drop one",
  dayId: "d1",
  dayNumber: 1,
}

describe("mergeFindings", () => {
  it("merges deterministic and judgment findings with no overlap", () => {
    const merged = mergeFindings([det], [jud])
    assert.equal(merged.length, 2)
  })

  it("dedupes by dayId + code, preferring the deterministic finding's id", () => {
    const dup: ItineraryReviewFinding = {
      ...jud,
      code: "missing-lunch",
      id: "d1:missing-lunch:judgment",
    }
    const merged = mergeFindings([det], [dup])
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.id, det.id)
  })

  it("attaches proposal from judgment finding onto matching deterministic finding", () => {
    const judWithProposal: ItineraryReviewFinding = {
      ...det,
      id: "d1:missing-lunch:j",
      proposal: {
        id: "p1",
        kind: "add-activities",
        dayId: "d1",
        summary: "Add lunch",
        payload: {
          activities: [
            {
              name: "Soba",
              type: "restaurant",
              description: "",
              suggestedTime: "12:30",
              estimatedDurationMinutes: 60,
              costEstimate: 10,
              tags: [],
            },
          ],
        },
      },
    }
    const merged = mergeFindings([det], [judWithProposal])
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.proposal?.kind, "add-activities")
  })
})

describe("REVIEWER_SYSTEM_PROMPT", () => {
  it("protects transport-type waypoints from removal findings", async () => {
    const { REVIEWER_SYSTEM_PROMPT } = await import("./itinerary-review-ai")
    assert.match(REVIEWER_SYSTEM_PROMPT, /transport/i)
    assert.match(REVIEWER_SYSTEM_PROMPT, /waypoint/i)
    assert.match(REVIEWER_SYSTEM_PROMPT, /never.*remov/i)
  })
})
