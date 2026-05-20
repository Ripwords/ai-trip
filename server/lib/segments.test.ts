import assert from "node:assert/strict"
import test from "node:test"

import {
  computeTransitDepartureTimestamp,
  findMissingMatrixIndices,
  pickSegmentData,
  zonedTimeToUtcSeconds,
  type MatrixEntry,
} from "./segment-utils"

// ── zonedTimeToUtcSeconds ─────────────────────────────────────────────

test("zonedTimeToUtcSeconds: 09:00 Tokyo (UTC+9) → 00:00 UTC", () => {
  const ts = zonedTimeToUtcSeconds("2026-06-15", "09:00", "Asia/Tokyo")
  const expected = Math.floor(new Date("2026-06-15T00:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("zonedTimeToUtcSeconds: 09:00 EDT (summer NYC, UTC-4) → 13:00 UTC", () => {
  const ts = zonedTimeToUtcSeconds("2026-06-15", "09:00", "America/New_York")
  const expected = Math.floor(new Date("2026-06-15T13:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("zonedTimeToUtcSeconds: 09:00 EST (winter NYC, UTC-5) → 14:00 UTC", () => {
  // Same wall-clock, different month → different UTC due to DST.
  const ts = zonedTimeToUtcSeconds("2026-01-15", "09:00", "America/New_York")
  const expected = Math.floor(new Date("2026-01-15T14:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("zonedTimeToUtcSeconds: returns NaN for malformed input", () => {
  assert.ok(Number.isNaN(zonedTimeToUtcSeconds("not-a-date", "09:00", "UTC")))
  assert.ok(Number.isNaN(zonedTimeToUtcSeconds("2026-06-15", "bad-time", "UTC")))
})

// ── computeTransitDepartureTimestamp ──────────────────────────────────

test("transit departure: uses day date + first activity time, ceiled to the hour", () => {
  const now = new Date("2026-05-20T10:00:00Z")
  const ts = computeTransitDepartureTimestamp("2026-06-15", "09:30", now)

  // Expected: 2026-06-15T09:30Z → 10:00Z bucket (ceil keeps the timestamp
  // strictly in the future even when `now` is mid-hour).
  const expected = Math.floor(new Date("2026-06-15T10:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
  assert.equal(ts % 3600, 0)
})

test("transit departure: defaults to 09:00 when no first activity time", () => {
  const now = new Date("2026-05-20T10:00:00Z")
  const ts = computeTransitDepartureTimestamp("2026-06-15", null, now)

  const expected = Math.floor(new Date("2026-06-15T09:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("transit departure: clamps to future when day is in the past", () => {
  const now = new Date("2026-05-20T10:00:00Z")
  const ts = computeTransitDepartureTimestamp("2020-01-01", "09:00", now)

  const nowSec = Math.floor(now.getTime() / 1000)
  assert.ok(ts >= nowSec, "departure must not be in the past")
  assert.equal(ts % 3600, 0, "must be bucketed to the hour")
})

test("transit departure: strictly future even when now is mid-hour", () => {
  // Regression: floor-bucketing after `now + 60s` could land in the past
  // (e.g. now=10:30:45 → minimum=10:31:45 → floor-to-hour=10:00:00, which is
  // 30 minutes BEFORE now). Google Distance Matrix transit rejects past
  // departure_time and returns ZERO_RESULTS for every element.
  const now = new Date("2026-05-20T10:30:45Z")
  const ts = computeTransitDepartureTimestamp("2020-01-01", "09:00", now)
  const nowSec = now.getTime() / 1000
  assert.ok(ts > nowSec, `expected ${ts} to be strictly > ${nowSec}`)
})

test("transit departure: strictly future when target time on same day has passed", () => {
  // User opens app at 14:30, planning today's trip whose first activity was
  // at 09:00. target is in the past, must clamp to a future bucket.
  const now = new Date("2026-05-20T14:30:30Z")
  const ts = computeTransitDepartureTimestamp("2026-05-20", "09:00", now)
  const nowSec = now.getTime() / 1000
  assert.ok(ts > nowSec, `expected ${ts} to be strictly > ${nowSec}`)
})

test("transit departure: ignores malformed time and defaults to 09:00", () => {
  const now = new Date("2026-05-20T10:00:00Z")
  const ts = computeTransitDepartureTimestamp("2026-06-15", "not-a-time", now)

  const expected = Math.floor(new Date("2026-06-15T09:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("transit departure: with timezone, treats activity time as local wall clock", () => {
  // 09:00 in NYC (EDT, UTC-4) = 13:00 UTC. Ceil to hour stays at 13:00.
  const now = new Date("2026-05-20T10:00:00Z")
  const ts = computeTransitDepartureTimestamp("2026-06-15", "09:00", now, "America/New_York")
  const expected = Math.floor(new Date("2026-06-15T13:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("transit departure: with timezone, ceils non-round local times", () => {
  // 09:30 in Tokyo (JST, UTC+9) = 00:30 UTC. Ceil to 01:00 UTC.
  const now = new Date("2026-05-20T10:00:00Z")
  const ts = computeTransitDepartureTimestamp("2026-06-15", "09:30", now, "Asia/Tokyo")
  const expected = Math.floor(new Date("2026-06-15T01:00:00Z").getTime() / 1000)
  assert.equal(ts, expected)
})

test("transit departure: falls back to UTC interpretation when timezone is null", () => {
  const now = new Date("2026-05-20T10:00:00Z")
  const withTz = computeTransitDepartureTimestamp("2026-06-15", "09:00", now, null)
  const expected = Math.floor(new Date("2026-06-15T09:00:00Z").getTime() / 1000)
  assert.equal(withTz, expected)
})

// ── pickSegmentData ───────────────────────────────────────────────────

const okEntry: MatrixEntry = {
  status: "OK",
  duration: { value: 600, text: "10 mins" },
  distance: { value: 3000, text: "3.0 km" },
}

const zeroResultsEntry: MatrixEntry = {
  status: "ZERO_RESULTS",
}

test("pickSegmentData: uses primary when it has a duration", () => {
  const row = pickSegmentData(okEntry, undefined, "transit", "walking")
  assert.equal(row.durationSeconds, 600)
  assert.equal(row.durationText, "10 mins")
  assert.equal(row.distanceMeters, 3000)
  assert.equal(row.distanceText, "3.0 km")
  assert.equal(row.mode, "transit")
})

test("pickSegmentData: falls back to walking when primary has ZERO_RESULTS", () => {
  const walkingEntry: MatrixEntry = {
    status: "OK",
    duration: { value: 720, text: "12 mins" },
    distance: { value: 950, text: "0.9 km" },
  }
  const row = pickSegmentData(zeroResultsEntry, walkingEntry, "transit", "walking")
  assert.equal(row.durationSeconds, 720)
  assert.equal(row.durationText, "12 mins")
  assert.equal(row.distanceMeters, 950)
  assert.equal(row.mode, "walking", "mode should reflect the fallback that actually returned data")
})

test("pickSegmentData: returns nulls when neither primary nor fallback has data", () => {
  const row = pickSegmentData(zeroResultsEntry, zeroResultsEntry, "transit", "walking")
  assert.equal(row.durationSeconds, null)
  assert.equal(row.distanceMeters, null)
  assert.equal(row.durationText, null)
  assert.equal(row.distanceText, null)
  assert.equal(row.mode, "transit", "preserves requested mode so the UI can label it")
})

test("pickSegmentData: handles undefined primary entry", () => {
  const row = pickSegmentData(undefined, okEntry, "transit", "walking")
  assert.equal(row.durationSeconds, 600)
  assert.equal(row.mode, "walking")
})

// ── findMissingMatrixIndices ──────────────────────────────────────────

test("findMissingMatrixIndices: returns diagonal indices with no duration", () => {
  // 3 pairs: A→B (OK), B→C (ZERO_RESULTS), C→D (OK)
  const matrix: MatrixEntry[][] = [
    [okEntry, okEntry, okEntry],
    [okEntry, zeroResultsEntry, okEntry],
    [okEntry, okEntry, okEntry],
  ]

  assert.deepEqual(findMissingMatrixIndices(matrix, 3), [1])
})

test("findMissingMatrixIndices: returns empty when all elements have data", () => {
  const matrix: MatrixEntry[][] = [
    [okEntry, okEntry],
    [okEntry, okEntry],
  ]
  assert.deepEqual(findMissingMatrixIndices(matrix, 2), [])
})

test("findMissingMatrixIndices: treats missing rows as missing", () => {
  const matrix: MatrixEntry[][] = []
  assert.deepEqual(findMissingMatrixIndices(matrix, 2), [0, 1])
})
