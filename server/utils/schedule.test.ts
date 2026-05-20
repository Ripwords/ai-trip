import assert from "node:assert/strict"
import test from "node:test"

import { computeSchedule } from "./schedule"

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
