import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { haversineKm, farFromAnchor } from "./geo"

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    assert.equal(haversineKm({ lat: 16, lng: 108 }, { lat: 16, lng: 108 }), 0)
  })

  it("is ~111km for one degree of latitude", () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    assert.ok(d > 110 && d < 112, `expected ~111, got ${d}`)
  })

  it("measures the Four Seasons Hoi An → Da Nang city gap at ~15-20km", () => {
    // Four Seasons Nam Hai (Hoi An) to the Dragon Bridge (Da Nang)
    const d = haversineKm({ lat: 15.929, lng: 108.318 }, { lat: 16.061, lng: 108.228 })
    assert.ok(d > 14 && d < 22, `expected ~15-20km, got ${d}`)
  })

  it("is symmetric", () => {
    const a = { lat: 15.929, lng: 108.318 }
    const b = { lat: 16.061, lng: 108.228 }
    assert.equal(haversineKm(a, b), haversineKm(b, a))
  })
})

describe("farFromAnchor", () => {
  const anchor = { lat: 15.929, lng: 108.318 } // Four Seasons Hoi An
  const acts = [
    { lat: 15.927, lng: 108.322 }, // Ha My Beach — next to hotel
    { lat: 16.061, lng: 108.228 }, // Dragon Bridge — ~18km north
    { lat: null, lng: null }, // missing coords
  ]

  it("returns only activities beyond the threshold, with distances", () => {
    const far = farFromAnchor(acts, anchor, 12)
    assert.equal(far.length, 1)
    assert.equal(far[0]!.index, 1)
    assert.ok(far[0]!.distanceKm > 12)
  })

  it("returns nothing when the anchor is null or coordless", () => {
    assert.deepEqual(farFromAnchor(acts, null, 12), [])
    assert.deepEqual(farFromAnchor(acts, { lat: null as never, lng: null as never }, 12), [])
  })

  it("skips activities without coordinates", () => {
    const far = farFromAnchor(acts, anchor, 1)
    assert.ok(!far.some((f) => f.index === 2))
  })
})
