import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { todayCalendarDate } from "../utils/calendar-date"
import { useCalendarToday } from "./useCalendarToday"

// 20:00Z is already the next day anywhere east of UTC+4 and still this day
// west of it, so the UTC date and the viewer's date can disagree.
const NOW = new Date("2026-10-11T20:00:00Z")

describe("useCalendarToday", () => {
  it("renders the same date the server did while hydrating, then the viewer's own once mounted", () => {
    let mounted: (() => void) | undefined
    const today = useCalendarToday({
      hydrating: true,
      now: () => NOW,
      onMounted: (fn) => {
        mounted = fn
      },
    })
    assert.equal(today.value, "2026-10-11")
    assert.ok(mounted, "registers a mount hook")
    mounted()
    assert.equal(today.value, todayCalendarDate(NOW))
  })

  it("is the viewer's own date straight away after a client-side navigation", () => {
    const today = useCalendarToday({
      hydrating: false,
      now: () => NOW,
      onMounted: () => assert.fail("no mount hook needed"),
    })
    assert.equal(today.value, todayCalendarDate(NOW))
  })
})
