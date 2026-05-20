import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatItineraryReviewMessage, reviewItinerary } from "./itinerary-review"
import type { ItineraryReviewFinding } from "./itinerary-review"

const baseDay = {
  id: "day-1",
  dayNumber: 1,
  date: "2026-06-01",
  notes: null,
  accommodationName: null,
  accommodationAddress: null,
  accommodationLat: null,
  accommodationLng: null,
  accommodationPlaceId: null,
  activities: [],
  travelSegments: [],
}

const trip = {
  id: "trip-1",
  destination: "Tokyo",
  days: [
    {
      ...baseDay,
      activities: [
        {
          id: "a1",
          name: "Museum",
          type: "museum",
          lat: null,
          lng: 139.76,
          suggestedTime: "10:00",
          estimatedDurationMinutes: 180,
          sortOrder: 1,
        },
        {
          id: "a2",
          name: "Temple",
          type: "attraction",
          lat: 35.68,
          lng: 139.77,
          suggestedTime: "12:00",
          estimatedDurationMinutes: 90,
          sortOrder: 2,
        },
        {
          id: "a3",
          name: "Observation Deck",
          type: "attraction",
          lat: 35.69,
          lng: 139.78,
          suggestedTime: "21:30",
          estimatedDurationMinutes: 90,
          sortOrder: 3,
        },
      ],
      travelSegments: [{ fromActivityId: "a2", toActivityId: "a3", durationSeconds: 5400 }],
    },
    {
      ...baseDay,
      id: "day-2",
      dayNumber: 2,
      date: "2026-06-02",
      accommodationName: "Hotel",
      accommodationAddress: "1 Station Road",
      accommodationLat: 35.67,
      accommodationLng: 139.76,
      activities: [
        {
          id: "b1",
          name: "Coffee",
          type: "cafe",
          lat: 35.67,
          lng: 139.76,
          suggestedTime: "09:00",
          estimatedDurationMinutes: 45,
          sortOrder: 1,
        },
      ],
      travelSegments: [],
    },
  ],
}

describe("reviewItinerary", () => {
  it("groups deterministic feasibility findings by severity", () => {
    const result = reviewItinerary(trip, { scope: "trip" })

    const criticalCodes = new Set(result.findings.critical.map((finding) => finding.code))
    const warningCodes = new Set(result.findings.warning.map((finding) => finding.code))
    const suggestionCodes = new Set(result.findings.suggestion.map((finding) => finding.code))

    assert.equal(result.summary.checkedDays, 2)
    assert.equal(result.summary.checkedActivities, 4)
    assert.ok(criticalCodes.has("activity-overlap"))
    assert.ok(warningCodes.has("missing-start-point"))
    assert.ok(warningCodes.has("long-travel-segment"))
    assert.ok(warningCodes.has("late-ending"))
    assert.ok(suggestionCodes.has("missing-lunch"))
    assert.ok(suggestionCodes.has("missing-dinner"))
    assert.ok(warningCodes.has("missing-activity-coordinates"))
  })

  it("limits day scope to the requested day", () => {
    const result = reviewItinerary(trip, { scope: "day", dayId: "day-2" })

    assert.equal(result.summary.checkedDays, 1)
    assert.equal(result.summary.checkedActivities, 1)
    assert.deepEqual(result.findings.critical, [])
    assert.equal(
      result.findings.warning.some((finding) => finding.dayId === "day-1"),
      false,
    )
  })

  it("uses the previous day's accommodation as the next day's start point", () => {
    const result = reviewItinerary(
      {
        id: "trip-previous-stay",
        days: [
          {
            ...baseDay,
            accommodationName: "Hotel",
            accommodationAddress: "1 Station Road",
            accommodationLat: 35.67,
            accommodationLng: 139.76,
          },
          {
            ...baseDay,
            id: "day-2",
            dayNumber: 2,
            date: "2026-06-02",
          },
        ],
      },
      { scope: "day", dayId: "day-2" },
    )

    assert.equal(
      result.findings.warning.some((finding) => finding.code === "missing-start-point"),
      false,
    )
  })

  it("throws when day scope is requested without a matching day", () => {
    assert.throws(
      () => reviewItinerary(trip, { scope: "day", dayId: "missing-day" }),
      /Day not found/,
    )
  })

  it("formats chat-friendly review summaries", () => {
    const result = reviewItinerary(trip, { scope: "trip" })
    const message = formatItineraryReviewMessage(result)

    assert.match(message, /I found \d+ issues in this trip/)
    assert.match(message, /Day 1:/)
    assert.match(message, /critical/)
  })
})

describe("ItineraryReviewFinding type", () => {
  it("accepts the new judgment codes", () => {
    const f: ItineraryReviewFinding = {
      id: "x",
      code: "pace-mismatch",
      severity: "warning",
      title: "Pace mismatch",
      message: "...",
      recommendation: "...",
      dayId: "d1",
      dayNumber: 1,
    }
    assert.equal(f.code, "pace-mismatch")
  })

  it("accepts an optional proposal field", () => {
    const f: ItineraryReviewFinding = {
      id: "x",
      code: "missing-lunch",
      severity: "suggestion",
      title: "Lunch missing",
      message: "...",
      recommendation: "...",
      dayId: "d1",
      dayNumber: 1,
      proposal: {
        id: "p1",
        kind: "add-activities",
        dayId: "d1",
        summary: "Add lunch",
        payload: {
          activities: [
            {
              name: "Soba Spot",
              type: "restaurant",
              description: "",
              suggestedTime: "12:30",
              estimatedDurationMinutes: 60,
              costEstimate: 12,
              tags: [],
            },
          ],
        },
      },
    }
    assert.equal(f.proposal?.kind, "add-activities")
  })
})
