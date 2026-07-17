import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildTripContext, type DiscussContextTrip } from "./discuss-context"

const trip: DiscussContextTrip = {
  destination: "Da Nang, Vietnam",
  startDate: "2026-08-16",
  endDate: "2026-08-20",
  currencyCode: "VND",
  preferences: { pace: "moderate" },
  days: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      dayNumber: 1,
      date: "2026-08-16",
      accommodationName: "Four Seasons Nam Hai",
      activities: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          sortOrder: 0,
          suggestedTime: "10:00",
          estimatedDurationMinutes: 60,
          name: "Sound of Silence Coffee",
          type: "cafe",
        },
      ],
    },
  ],
}

describe("buildTripContext", () => {
  it("renders days, activities, and accommodation with bracketed ids", () => {
    const ctx = buildTripContext(trip, trip.days[0]!.id)
    assert.match(ctx, /Day 1 \(2026-08-16\) \[day:11111111-1111-4111-8111-111111111111\]/)
    assert.match(ctx, /· OPEN/)
    assert.match(ctx, /\[act:22222222-2222-4222-8222-222222222222\] 10:00 Sound of Silence Coffee/)
    assert.match(ctx, /staying at Four Seasons Nam Hai/)
  })

  it("includes the traveler's flights and the hard flight rules when flights exist", () => {
    const ctx = buildTripContext(trip, null, [
      {
        departureAirport: "SIN",
        arrivalAirport: "DAD",
        departureTimeUtc: null,
        arrivalTimeUtc: null,
        departureTimeLocal: "2026-08-16 09:10+08:00",
        arrivalTimeLocal: "2026-08-16 11:05+07:00",
      },
    ])
    assert.match(ctx, /TRAVELER'S FLIGHTS/)
    assert.match(ctx, /SIN → DAD/)
    assert.match(ctx, /2026-08-16 11:05\+07:00 \(local time\)/)
    assert.match(ctx, /FLIGHT RULES/)
    assert.match(ctx, /Schedule NOTHING before/)
  })

  it("omits the flights section when there are no flights", () => {
    assert.doesNotMatch(buildTripContext(trip, null), /TRAVELER'S FLIGHTS/)
    assert.doesNotMatch(buildTripContext(trip, null, []), /TRAVELER'S FLIGHTS/)
  })
})
