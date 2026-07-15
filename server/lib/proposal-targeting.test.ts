import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveTargetDay, resolveTargetDays, stampGroup } from "./proposal-targeting"

const days = [
  { id: "d1", dayNumber: 1 },
  { id: "d2", dayNumber: 2 },
  { id: "d3", dayNumber: 3 },
]

describe("resolveTargetDay", () => {
  it("uses the explicit dayId when it belongs to the trip", () => {
    assert.deepEqual(resolveTargetDay(days, "d1", "d3"), { ok: true, dayId: "d3" })
  })
  it("falls back to the active day when no dayId is given", () => {
    assert.deepEqual(resolveTargetDay(days, "d2"), { ok: true, dayId: "d2" })
  })
  it("rejects a dayId that is not in the trip", () => {
    const r = resolveTargetDay(days, "d1", "other-trip-day")
    assert.equal(r.ok, false)
  })
  it("errors when there is neither an active day nor a dayId", () => {
    const r = resolveTargetDay(days, "", undefined)
    assert.equal(r.ok, false)
  })
})

describe("resolveTargetDays", () => {
  it("expands dayIds, validating each", () => {
    assert.deepEqual(resolveTargetDays(days, "d1", { dayIds: ["d1", "d3"] }), {
      ok: true,
      dayIds: ["d1", "d3"],
    })
  })
  it("rejects when any dayId is not in the trip", () => {
    const r = resolveTargetDays(days, "d1", { dayIds: ["d1", "nope"] })
    assert.equal(r.ok, false)
  })
  it("falls back to single active day when neither dayId nor dayIds given", () => {
    assert.deepEqual(resolveTargetDays(days, "d2", {}), { ok: true, dayIds: ["d2"] })
  })
})

describe("stampGroup", () => {
  it("stamps a shared groupId when more than one item", () => {
    const out = stampGroup([{ id: "a" }, { id: "b" }] as { id: string; groupId?: string }[], "g1")
    assert.equal(out[0]!.groupId, "g1")
    assert.equal(out[1]!.groupId, "g1")
  })
  it("leaves a single item ungrouped", () => {
    const out = stampGroup([{ id: "a" }] as { id: string; groupId?: string }[], "g1")
    assert.equal(out[0]!.groupId, undefined)
  })
})
