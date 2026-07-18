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

describe("flight findings", () => {
  const flightTrip = {
    id: "trip-f",
    destination: "Da Nang",
    flights: [
      {
        departureAirport: "SIN",
        arrivalAirport: "DAD",
        departureTimeLocal: "2026-06-01 09:10+08:00",
        arrivalTimeLocal: "2026-06-01 11:05+07:00",
      },
      {
        departureAirport: "DAD",
        arrivalAirport: "SIN",
        departureTimeLocal: "2026-06-02 18:00+07:00",
        arrivalTimeLocal: "2026-06-02 22:10+08:00",
      },
    ],
    days: [
      {
        ...baseDay,
        activities: [
          {
            id: "f1",
            name: "Beach Cafe",
            type: "cafe",
            lat: 16.05,
            lng: 108.25,
            suggestedTime: "10:00",
            estimatedDurationMinutes: 60,
            sortOrder: 1,
          },
        ],
      },
      {
        ...baseDay,
        id: "day-2",
        dayNumber: 2,
        date: "2026-06-02",
        activities: [
          {
            id: "f2",
            name: "Marble Mountains",
            type: "attraction",
            lat: 16.0,
            lng: 108.26,
            suggestedTime: "16:00",
            estimatedDurationMinutes: 120,
            sortOrder: 1,
          },
        ],
      },
    ],
  }

  it("flags activities that start before an arrival flight clears the airport", () => {
    const result = reviewItinerary(flightTrip, { scope: "day", dayId: "day-1" })
    const finding = result.findings.critical.find(
      (f) => f.code === "activity-before-flight-arrival",
    )
    assert.ok(finding, "expected activity-before-flight-arrival finding")
    assert.deepEqual(finding.activityIds, ["f1"])
  })

  it("flags activities that end after the departure-flight cutoff", () => {
    const result = reviewItinerary(flightTrip, { scope: "day", dayId: "day-2" })
    const finding = result.findings.critical.find(
      (f) => f.code === "activity-after-flight-departure",
    )
    assert.ok(finding, "expected activity-after-flight-departure finding")
    assert.deepEqual(finding.activityIds, ["f2"])
  })

  it("emits no flight findings when the schedule respects the flights", () => {
    const okTrip = {
      ...flightTrip,
      days: [
        {
          ...baseDay,
          activities: [
            {
              id: "f3",
              name: "Dinner",
              type: "restaurant",
              lat: 16.05,
              lng: 108.25,
              suggestedTime: "19:00",
              estimatedDurationMinutes: 90,
              sortOrder: 1,
            },
          ],
        },
      ],
    }
    const result = reviewItinerary(okTrip, { scope: "day", dayId: "day-1" })
    const codes = new Set(
      [...result.findings.critical, ...result.findings.warning].map((f) => f.code),
    )
    assert.ok(!codes.has("activity-before-flight-arrival"))
    assert.ok(!codes.has("activity-after-flight-departure"))
  })

  it("ignores flights whose local date doesn't match the day", () => {
    const result = reviewItinerary(flightTrip, { scope: "day", dayId: "day-1" })
    const codes = result.findings.critical.map((f) => f.code)
    assert.ok(!codes.includes("activity-after-flight-departure"))
  })
})

describe("evening activity far from tonight's stay", () => {
  const dayBase = {
    id: "d1",
    dayNumber: 1,
    date: "2026-08-16",
    notes: null,
    accommodationName: "Four Seasons Nam Hai",
    accommodationAddress: "Hoi An",
    accommodationLat: 15.929,
    accommodationLng: 108.318,
    accommodationPlaceId: null,
    travelSegments: [],
  }

  it("flags a late-evening activity far north when the stay is far south", () => {
    const trip = {
      id: "t",
      destination: "Vietnam",
      days: [
        {
          ...dayBase,
          activities: [
            {
              id: "a1",
              name: "Ha My Beach",
              type: "attraction",
              lat: 15.927,
              lng: 108.322,
              suggestedTime: "14:15",
              estimatedDurationMinutes: 90,
              sortOrder: 0,
            },
            {
              id: "a2",
              name: "Dragon Bridge Fire Show",
              type: "entertainment",
              lat: 16.061,
              lng: 108.228,
              suggestedTime: "22:30",
              estimatedDurationMinutes: 60,
              sortOrder: 1,
            },
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "d1" })
    const f = res.findings.warning.find((x) => x.code === "evening-activity-far-from-stay")
    assert.ok(f, "expected evening-activity-far-from-stay finding")
    assert.deepEqual(f.activityIds, ["a2"])
    assert.doesNotMatch(JSON.stringify(f.activityIds), /a1/) // daytime beach not flagged
  })

  it("does not flag when evening activities are near the stay", () => {
    const trip = {
      id: "t",
      destination: "Vietnam",
      days: [
        {
          ...dayBase,
          activities: [
            {
              id: "b1",
              name: "Dinner at resort",
              type: "restaurant",
              lat: 15.929,
              lng: 108.317,
              suggestedTime: "19:30",
              estimatedDurationMinutes: 90,
              sortOrder: 0,
            },
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "d1" })
    assert.ok(!res.findings.warning.some((x) => x.code === "evening-activity-far-from-stay"))
  })

  it("carries the stay forward to a night with no accommodation of its own", () => {
    const trip = {
      id: "t",
      destination: "Vietnam",
      days: [
        { ...dayBase, activities: [] },
        {
          ...dayBase,
          id: "d2",
          dayNumber: 2,
          date: "2026-08-17",
          accommodationName: null,
          accommodationLat: null,
          accommodationLng: null,
          activities: [
            {
              id: "c1",
              name: "Late Da Nang bar",
              type: "bar",
              lat: 16.06,
              lng: 108.23,
              suggestedTime: "21:00",
              estimatedDurationMinutes: 60,
              sortOrder: 0,
            },
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "d2" })
    assert.ok(res.findings.warning.some((x) => x.code === "evening-activity-far-from-stay"))
  })
})

describe("insufficient transfer time (travel doesn't fit the gap)", () => {
  const dayBase3 = {
    id: "d3",
    dayNumber: 3,
    date: "2026-08-18",
    notes: null,
    accommodationName: "Homestay",
    accommodationAddress: "Hoi An",
    accommodationLat: 15.89,
    accommodationLng: 108.32,
    accommodationPlaceId: null,
    activities: [
      {
        id: "cafe",
        name: "Cộng Cà Phê",
        type: "cafe",
        lat: 16.069,
        lng: 108.225,
        suggestedTime: "14:30",
        estimatedDurationMinutes: 60,
        sortOrder: 0,
      },
      {
        id: "buddha",
        name: "Lady Buddha",
        type: "attraction",
        lat: 16.1,
        lng: 108.278,
        suggestedTime: "15:45",
        estimatedDurationMinutes: 90,
        sortOrder: 1,
      },
    ],
  }

  it("warns when the drive overruns the gap by a few minutes", () => {
    const trip = {
      id: "t",
      destination: "Da Nang",
      days: [
        {
          ...dayBase3,
          travelSegments: [
            { fromActivityId: "cafe", toActivityId: "buddha", durationSeconds: 23 * 60 },
          ],
        },
      ],
    }
    // cafe ends 15:30, +23min = 15:53, buddha at 15:45 → 8-min overrun (warning)
    const res = reviewItinerary(trip, { scope: "day", dayId: "d3" })
    const f = res.findings.warning.find((x) => x.code === "insufficient-transfer-time")
    assert.ok(f, "expected insufficient-transfer-time warning")
    assert.deepEqual(f.activityIds, ["cafe", "buddha"])
  })

  it("escalates to critical when the arrival is well past the next start", () => {
    const trip = {
      id: "t",
      destination: "Da Nang",
      days: [
        {
          ...dayBase3,
          travelSegments: [
            { fromActivityId: "cafe", toActivityId: "buddha", durationSeconds: 45 * 60 },
          ],
        },
      ],
    }
    // cafe ends 15:30, +45min = 16:15, buddha at 15:45 → 30-min overrun (critical)
    const res = reviewItinerary(trip, { scope: "day", dayId: "d3" })
    assert.ok(res.findings.critical.some((x) => x.code === "insufficient-transfer-time"))
  })

  it("ignores a rounding-level overrun within the grace window", () => {
    const trip = {
      id: "t",
      destination: "Da Nang",
      days: [
        {
          ...dayBase3,
          // cafe ends 15:30, buddha 15:44, 15-min drive → arrive 15:45, 1-min overrun (< grace)
          activities: [
            dayBase3.activities[0]!,
            { ...dayBase3.activities[1]!, suggestedTime: "15:44" },
          ],
          travelSegments: [
            { fromActivityId: "cafe", toActivityId: "buddha", durationSeconds: 15 * 60 },
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "d3" })
    const all = [...res.findings.critical, ...res.findings.warning]
    assert.ok(!all.some((x) => x.code === "insufficient-transfer-time"))
  })

  it("does not flag when the drive comfortably fits the gap", () => {
    const trip = {
      id: "t",
      destination: "Da Nang",
      days: [
        {
          ...dayBase3,
          activities: [
            dayBase3.activities[0]!,
            { ...dayBase3.activities[1]!, suggestedTime: "16:45" }, // 75-min gap
          ],
          travelSegments: [
            { fromActivityId: "cafe", toActivityId: "buddha", durationSeconds: 23 * 60 },
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "d3" })
    assert.ok(!res.findings.critical.some((x) => x.code === "insufficient-transfer-time"))
  })

  it("does not double-flag a raw overlap as a transfer conflict", () => {
    const trip = {
      id: "t",
      destination: "Da Nang",
      days: [
        {
          ...dayBase3,
          activities: [
            dayBase3.activities[0]!,
            { ...dayBase3.activities[1]!, suggestedTime: "15:00" }, // starts before cafe ends (raw overlap)
          ],
          travelSegments: [
            { fromActivityId: "cafe", toActivityId: "buddha", durationSeconds: 23 * 60 },
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "d3" })
    assert.ok(res.findings.critical.some((x) => x.code === "activity-overlap"))
    assert.ok(!res.findings.critical.some((x) => x.code === "insufficient-transfer-time"))
  })
})

describe("opening-hours findings", () => {
  const base = {
    id: "oh",
    dayNumber: 2,
    date: "2026-08-17", // Monday
    notes: null,
    accommodationName: null,
    accommodationAddress: null,
    accommodationLat: null,
    accommodationLng: null,
    accommodationPlaceId: null,
    travelSegments: [],
  }
  const act = (over: Record<string, unknown>) => ({
    id: "v",
    name: "Marble Mountains",
    type: "attraction",
    lat: 16.0,
    lng: 108.26,
    suggestedTime: "10:00",
    estimatedDurationMinutes: 60,
    sortOrder: 0,
    openingHours: ["Monday: 7:00 AM – 5:30 PM"],
    ...over,
  })

  it("flags a stop scheduled after the venue closes", () => {
    const trip = { id: "t", days: [{ ...base, activities: [act({ suggestedTime: "18:00" })] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh" })
    const f = res.findings.warning.find((x) => x.code === "activity-outside-opening-hours")
    assert.ok(f && /closes/.test(f.message))
    assert.deepEqual(f.activityIds, ["v"])
  })

  it("flags a stop scheduled before the venue opens", () => {
    const trip = { id: "t", days: [{ ...base, activities: [act({ suggestedTime: "06:00" })] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh" })
    assert.ok(
      res.findings.warning.some(
        (x) => x.code === "activity-outside-opening-hours" && /open/.test(x.message),
      ),
    )
  })

  it("flags a venue closed on the scheduled day (critical)", () => {
    const trip = {
      id: "t",
      days: [{ ...base, activities: [act({ openingHours: ["Monday: Closed"] })] }],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh" })
    assert.ok(res.findings.critical.some((x) => x.code === "venue-closed-on-day"))
  })

  it("does not flag a stop comfortably within opening hours", () => {
    const trip = { id: "t", days: [{ ...base, activities: [act({ suggestedTime: "10:00" })] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh" })
    assert.ok(!res.findings.warning.some((x) => x.code === "activity-outside-opening-hours"))
    assert.ok(!res.findings.critical.some((x) => x.code === "venue-closed-on-day"))
  })

  it("skips when hours are missing or 24h", () => {
    const trip = {
      id: "t",
      days: [
        {
          ...base,
          activities: [
            act({ id: "n", openingHours: null, suggestedTime: "23:00" }),
            act({ id: "h", openingHours: ["Monday: Open 24 hours"], suggestedTime: "03:00" }),
          ],
        },
      ],
    }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh" })
    assert.ok(!res.findings.warning.some((x) => x.code === "activity-outside-opening-hours"))
  })
})

describe("duration runs past closing", () => {
  const base = {
    id: "oh2",
    dayNumber: 2,
    date: "2026-08-17",
    notes: null,
    accommodationName: null,
    accommodationAddress: null,
    accommodationLat: null,
    accommodationLng: null,
    accommodationPlaceId: null,
    travelSegments: [],
  }
  const act = (over: Record<string, unknown>) => ({
    id: "v",
    name: "Marble Mountains",
    type: "attraction",
    lat: 16.0,
    lng: 108.26,
    suggestedTime: "16:30",
    estimatedDurationMinutes: 90,
    sortOrder: 0,
    openingHours: ["Monday: 7:00 AM – 5:30 PM"],
    ...over,
  })

  it("warns when the planned end runs well past closing", () => {
    // 16:30 + 90 = 18:00, closes 17:30 -> 30 min past close
    const trip = { id: "t", days: [{ ...base, activities: [act({})] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh2" })
    const f = res.findings.warning.find(
      (x) => x.code === "activity-outside-opening-hours" && /cut short/.test(x.message),
    )
    assert.ok(f, "expected runs-past-closing warning")
  })

  it("does not flag a visit that ends before closing", () => {
    // 15:00 + 90 = 16:30, closes 17:30 -> fine
    const trip = { id: "t", days: [{ ...base, activities: [act({ suggestedTime: "15:00" })] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "oh2" })
    assert.ok(!res.findings.warning.some((x) => x.code === "activity-outside-opening-hours"))
  })
})

describe("activities out of time order", () => {
  const base = {
    id: "ord", dayNumber: 1, date: "2026-08-16", notes: null,
    accommodationName: null, accommodationAddress: null, accommodationLat: null,
    accommodationLng: null, accommodationPlaceId: null, travelSegments: [],
  }
  const a = (id: string, time: string, sortOrder: number) => ({
    id, name: id, type: "attraction", lat: 16.0, lng: 108.2,
    suggestedTime: time, estimatedDurationMinutes: 30, sortOrder,
  })

  it("flags a later-listed stop with an earlier time", () => {
    const trip = { id: "t", days: [{ ...base, activities: [a("A", "09:00", 0), a("B", "14:00", 1), a("C", "10:00", 2)] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "ord" })
    const f = res.findings.warning.find((x) => x.code === "activities-out-of-order")
    assert.ok(f, "expected activities-out-of-order")
    assert.deepEqual(f.activityIds, ["B", "C"])
  })

  it("does not flag a day whose times run in order", () => {
    const trip = { id: "t", days: [{ ...base, activities: [a("A", "09:00", 0), a("B", "10:00", 1), a("C", "14:00", 2)] }] }
    const res = reviewItinerary(trip, { scope: "day", dayId: "ord" })
    assert.ok(!res.findings.warning.some((x) => x.code === "activities-out-of-order"))
  })
})
