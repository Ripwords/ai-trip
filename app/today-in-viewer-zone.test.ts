import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

/**
 * "Today" is the viewer's calendar day. Reading it off `toISOString()` gives
 * the UTC day, which is wrong for most of the evening west of UTC and most of
 * the morning east of it: today's itinerary day, the next flight and the
 * upcoming/past split all shifted by a day.
 */
const FILES = [
  "./components/TripOverview.vue",
  "./pages/trips/[id].vue",
  "./pages/dashboard.vue",
  "./pages/flights.vue",
]

const UTC_TODAY = /\.toISOString\(\)\.(?:split\("T"\)\[0\]|slice\(0, 10\))/

describe("today is the viewer's calendar day", () => {
  for (const file of FILES) {
    it(`${file} never takes today from the UTC date`, () => {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8")
      const offending = source.split("\n").filter((line) => UTC_TODAY.test(line))
      assert.deepEqual(offending, [])
    })
  }
})
