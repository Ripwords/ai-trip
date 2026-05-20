import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ref } from "vue"
import { useDiscussionStarters } from "./useDiscussionStarters"

function fakeDay(n: number, activitiesCount: number, accommodation: string | null = "Hotel") {
  return {
    id: `d-${n}`,
    dayNumber: n,
    date: `2026-06-0${n}`,
    notes: null,
    accommodationName: accommodation,
    accommodationAddress: null,
    accommodationLat: null,
    accommodationLng: null,
    accommodationPlaceId: null,
    activities: Array.from({ length: activitiesCount }, (_, i) => ({
      id: `a-${n}-${i}`,
      name: `Place ${i}`,
      type: "attraction",
    })),
    travelSegments: [],
  } as never
}

function fakeTrip(days: ReturnType<typeof fakeDay>[]) {
  return {
    id: "t-1",
    destination: "Tokyo",
    days,
  } as never
}

describe("useDiscussionStarters", () => {
  it("suggests 'too packed' when active day has 6+ activities", () => {
    const trip = ref(fakeTrip([fakeDay(1, 7)]))
    const day = ref(fakeDay(1, 7))
    const starters = useDiscussionStarters(trip, day)
    assert.ok(starters.value.some((s) => /too packed/i.test(s)))
  })

  it("suggests 'rearrange days' when trip has 3+ days", () => {
    const days = [fakeDay(1, 2), fakeDay(2, 2), fakeDay(3, 2)]
    const trip = ref(fakeTrip(days))
    const day = ref(days[0]!)
    const starters = useDiscussionStarters(trip, day)
    assert.ok(starters.value.some((s) => /rearrange/i.test(s)))
  })

  it("suggests 'pick a hotel' when any day lacks accommodation", () => {
    const days = [fakeDay(1, 2, "Hotel"), fakeDay(2, 2, null)]
    const trip = ref(fakeTrip(days))
    const day = ref(days[0]!)
    const starters = useDiscussionStarters(trip, day)
    assert.ok(starters.value.some((s) => /hotel/i.test(s)))
  })

  it("falls back to a destination-specific suggestion", () => {
    const days = [fakeDay(1, 2)]
    const trip = ref(fakeTrip(days))
    const day = ref(days[0]!)
    const starters = useDiscussionStarters(trip, day)
    assert.ok(starters.value.some((s) => /Tokyo/.test(s)))
  })

  it("returns null/empty when trip is null", () => {
    const trip = ref(null)
    const day = ref(null)
    const starters = useDiscussionStarters(trip, day)
    assert.equal(starters.value.length, 0)
  })

  it("caps suggestions at 4", () => {
    const days = [fakeDay(1, 7, null), fakeDay(2, 7, null), fakeDay(3, 7, null)]
    const trip = ref(fakeTrip(days))
    const day = ref(days[0]!)
    const starters = useDiscussionStarters(trip, day)
    assert.ok(starters.value.length <= 4)
  })
})
