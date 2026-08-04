import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatCalendarDate, todayCalendarDate } from "./calendar-date"

describe("formatCalendarDate", () => {
  it("formats a plain calendar date without shifting it", () => {
    assert.equal(formatCalendarDate("2026-08-04"), "Aug 4, 2026")
    assert.equal(formatCalendarDate("2026-01-01"), "Jan 1, 2026")
    assert.equal(formatCalendarDate("2026-12-31"), "Dec 31, 2026")
  })

  it("tolerates a full timestamp by using its date part", () => {
    assert.equal(formatCalendarDate("2026-08-04T00:00:00.000Z"), "Aug 4, 2026")
  })

  it("returns an empty string for missing or malformed input", () => {
    for (const v of [null, undefined, "", "not-a-date", "2026-13-01", "2026-08-00"]) {
      assert.equal(formatCalendarDate(v), "")
    }
  })
})

describe("todayCalendarDate", () => {
  // `new Date().toISOString().split("T")[0]` returns the UTC date, which is
  // already tomorrow for anyone far enough east late in the day — so the form
  // defaulted to the wrong day before the user touched anything.
  it("uses local calendar parts, not the UTC date", () => {
    const localNewYearsEve = new Date(2026, 11, 31, 23, 30)
    assert.equal(todayCalendarDate(localNewYearsEve), "2026-12-31")
  })

  it("zero-pads month and day", () => {
    assert.equal(todayCalendarDate(new Date(2026, 0, 5)), "2026-01-05")
  })
})
