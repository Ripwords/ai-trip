import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { deriveTripStatus } = await import("./trip-status")

const today = new Date("2026-08-31T12:00:00Z")

describe("deriveTripStatus", () => {
  it("derives completed for a past trip still stored as upcoming", () => {
    const status = deriveTripStatus(
      { startDate: "2026-08-16", endDate: "2026-08-19", status: "upcoming" },
      today,
    )

    assert.equal(status, "completed")
  })

  it("derives completed for a past trip still stored with the legacy draft default", () => {
    const status = deriveTripStatus(
      { startDate: "2026-05-27", endDate: "2026-06-03", status: "draft" },
      today,
    )

    assert.equal(status, "completed")
  })

  it("derives upcoming for a future active trip", () => {
    const status = deriveTripStatus(
      { startDate: "2027-01-16", endDate: "2027-01-18", status: "active" },
      today,
    )

    assert.equal(status, "upcoming")
  })

  it("derives ongoing when today is the start date", () => {
    const status = deriveTripStatus(
      { startDate: "2026-08-31", endDate: "2026-09-04", status: "active" },
      today,
    )

    assert.equal(status, "ongoing")
  })

  it("derives ongoing when today is the end date", () => {
    const status = deriveTripStatus(
      { startDate: "2026-08-27", endDate: "2026-08-31", status: "active" },
      today,
    )

    assert.equal(status, "ongoing")
  })

  it("returns cancelled regardless of the dates", () => {
    for (const [startDate, endDate] of [
      ["2026-08-16", "2026-08-19"],
      ["2026-08-31", "2026-09-04"],
      ["2027-01-16", "2027-01-18"],
    ] as const) {
      const status = deriveTripStatus({ startDate, endDate, status: "cancelled" }, today)

      assert.equal(status, "cancelled")
    }
  })
})
