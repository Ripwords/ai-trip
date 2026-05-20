import assert from "node:assert/strict"
import test from "node:test"

import { normalizeTransportMode, transportModeLabels } from "./transport"

test("normalizes supported transport modes", () => {
  assert.equal(normalizeTransportMode("walking"), "walking")
  assert.equal(normalizeTransportMode("transit"), "transit")
  assert.equal(normalizeTransportMode("bicycling"), "bicycling")
})

test("falls back to driving for unknown modes", () => {
  assert.equal(normalizeTransportMode("taxi"), "driving")
  assert.equal(normalizeTransportMode(undefined), "driving")
})

test("provides user-facing labels for all modes", () => {
  assert.deepEqual(Object.keys(transportModeLabels).toSorted(), [
    "bicycling",
    "driving",
    "transit",
    "walking",
  ])
})
