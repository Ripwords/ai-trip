import assert from "node:assert/strict"
import test from "node:test"

import {
  computeSchedule,
  orderDayActivities,
  parseClockMinutes,
  parseOpeningWindow,
} from "./schedule"

test("adds start travel time before the first activity", () => {
  const [first, second] = computeSchedule({
    startHour: 9,
    startMinute: 0,
    startTravelTimeMinutes: 25,
    activities: [
      { id: "a", name: "Museum", estimatedDurationMinutes: 60 },
      { id: "b", name: "Lunch", estimatedDurationMinutes: 45 },
    ],
    travelTimes: [{ fromId: "a", toId: "b", durationMinutes: 20 }],
    bufferMinutes: 10,
  })

  assert.equal(first?.suggestedTime, "09:25")
  assert.equal(second?.suggestedTime, "10:55")
})

test("does not start before opening time after start travel", () => {
  const [first] = computeSchedule({
    startHour: 8,
    startMinute: 30,
    startTravelTimeMinutes: 10,
    activities: [{ id: "a", name: "Gallery", estimatedDurationMinutes: 60, openingMinutes: 600 }],
  })

  assert.equal(first?.suggestedTime, "10:00")
})

test("holds an activity at its preferred time instead of packing it earlier", () => {
  const [coffee, dinner] = computeSchedule({
    startHour: 10,
    startMinute: 0,
    activities: [
      { id: "coffee", name: "Coffee", estimatedDurationMinutes: 90, preferredMinutes: 10 * 60 },
      {
        id: "dinner",
        name: "Dinner",
        estimatedDurationMinutes: 90,
        preferredMinutes: 19 * 60 + 30,
      },
    ],
    travelTimes: [{ fromId: "coffee", toId: "dinner", durationMinutes: 10 }],
    bufferMinutes: 15,
  })

  assert.equal(coffee?.suggestedTime, "10:00")
  // Dinner keeps its intended 19:30 slot — the gap is not collapsed.
  assert.equal(dinner?.suggestedTime, "19:30")
})

test("pushes a preferred time later when the previous activity overruns it", () => {
  const [, second] = computeSchedule({
    startHour: 10,
    startMinute: 0,
    activities: [
      { id: "a", name: "Long visit", estimatedDurationMinutes: 120, preferredMinutes: 10 * 60 },
      { id: "b", name: "Lunch", estimatedDurationMinutes: 60, preferredMinutes: 11 * 60 },
    ],
    travelTimes: [{ fromId: "a", toId: "b", durationMinutes: 10 }],
    bufferMinutes: 15,
  })

  // 12:00 end + 10 travel + 15 buffer → 12:25 (snapped), overrides the 11:00 wish.
  assert.equal(second?.suggestedTime, "12:25")
})

test("orderDayActivities sorts by suggested time with untimed entries last", () => {
  const ordered = orderDayActivities([
    { id: "dinner", suggestedTime: "19:30" },
    { id: "show", suggestedTime: "21:00" },
    { id: "beach", suggestedTime: "14:00" },
    { id: "lunch", suggestedTime: "12:00" },
    { id: "mystery", suggestedTime: null },
    { id: "coffee", suggestedTime: "10:00" },
  ])

  assert.deepEqual(
    ordered.map((a) => a.id),
    ["coffee", "lunch", "beach", "dinner", "show", "mystery"],
  )
})

test("orderDayActivities keeps relative order for equal times", () => {
  const ordered = orderDayActivities([
    { id: "first", suggestedTime: "09:00" },
    { id: "second", suggestedTime: "09:00" },
    { id: "third", suggestedTime: null },
    { id: "fourth", suggestedTime: null },
  ])

  assert.deepEqual(
    ordered.map((a) => a.id),
    ["first", "second", "third", "fourth"],
  )
})

test("orderDayActivities follows an explicit id order and slots leftovers by time", () => {
  const ordered = orderDayActivities(
    [
      { id: "a", suggestedTime: "09:00" },
      { id: "b", suggestedTime: "11:00" },
      { id: "c", suggestedTime: "10:00" },
      { id: "d", suggestedTime: "08:00" },
    ],
    ["b", "a"],
  )

  // Explicit order wins for listed ids; unlisted ids follow, sorted by time.
  assert.deepEqual(
    ordered.map((a) => a.id),
    ["b", "a", "d", "c"],
  )
})

test("parseClockMinutes parses HH:MM and rejects garbage", () => {
  assert.equal(parseClockMinutes("09:30"), 570)
  assert.equal(parseClockMinutes("19:05"), 1145)
  assert.equal(parseClockMinutes("9:5"), null)
  assert.equal(parseClockMinutes("25:00"), null)
  assert.equal(parseClockMinutes(null), null)
  assert.equal(parseClockMinutes("later"), null)
})

test("parseOpeningWindow returns open and close minutes", () => {
  // 2026-08-17 is a Monday
  const w = parseOpeningWindow(["Monday: 7:00 AM – 5:30 PM"], "2026-08-17")
  assert.deepEqual(w, { openMinutes: 7 * 60, closeMinutes: 17 * 60 + 30 })
})

test("parseOpeningWindow handles closes-after-midnight", () => {
  const w = parseOpeningWindow(["Monday: 6:00 PM – 2:00 AM"], "2026-08-17")
  assert.deepEqual(w, { openMinutes: 18 * 60, closeMinutes: 2 * 60 + 24 * 60 })
})

test("parseOpeningWindow reports a closed day", () => {
  assert.equal(parseOpeningWindow(["Monday: Closed"], "2026-08-17"), "closed")
})

test("parseOpeningWindow returns null for 24h, unknown day, or empty", () => {
  assert.equal(parseOpeningWindow(["Monday: Open 24 hours"], "2026-08-17"), null)
  assert.equal(parseOpeningWindow(["Tuesday: 9:00 AM – 5:00 PM"], "2026-08-17"), null)
  assert.equal(parseOpeningWindow([], "2026-08-17"), null)
  assert.equal(parseOpeningWindow(null, "2026-08-17"), null)
})
