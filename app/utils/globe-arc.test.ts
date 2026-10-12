import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { greatCircleArc } from "./globe-arc"

const KUL = { lat: 2.7456, lng: 101.7099 }
const CPT = { lat: -33.9715, lng: 18.6021 }
const R = 6

describe("greatCircleArc", () => {
  const points = greatCircleArc(KUL, CPT, R, 64)
  const len = (p: { length: () => number }) => p.length()

  it("starts and ends on the surface at each airport", () => {
    assert.ok(Math.abs(len(points[0]!) - R) < 1e-9)
    assert.ok(Math.abs(len(points.at(-1)!) - R) < 1e-9)
  })

  it("never dips below the surface, so the whole route stays visible", () => {
    for (const p of points) assert.ok(len(p) >= R - 1e-9)
  })

  it("rises highest in the middle", () => {
    const mid = len(points[32]!)
    assert.ok(mid > len(points[8]!))
    assert.ok(mid > len(points[56]!))
  })

  it("returns segments + 1 points", () => {
    assert.equal(points.length, 65)
  })

  it("handles the same airport twice without NaN", () => {
    for (const p of greatCircleArc(KUL, KUL, R, 8)) assert.ok(Number.isFinite(len(p)))
  })
})
