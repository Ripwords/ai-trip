import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DEFAULT_DESIGN, hasCuratedCover, passportCoverDesign } from "./passport-covers"

describe("passport cover designs", () => {
  it("applies the EU burgundy standard to member states", () => {
    const codes = ["FR", "DE", "IT", "ES", "IE"]
    const covers = new Set(codes.map((code) => passportCoverDesign(code).cover))

    assert.equal(covers.size, 1)
  })

  it("keeps Croatia distinct, the documented exception to that standard", () => {
    assert.notEqual(passportCoverDesign("HR").cover, passportCoverDesign("FR").cover)
  })

  it("shares one colour across Andean Community members", () => {
    const covers = new Set(["BO", "CO", "EC", "PE"].map((c) => passportCoverDesign(c).cover))

    assert.equal(covers.size, 1)
  })

  it("uses silver lettering where the cover calls for it", () => {
    assert.equal(passportCoverDesign("NZ").foil, "silver")
    assert.equal(passportCoverDesign("CH").foil, "silver")
    assert.equal(passportCoverDesign("FR").foil, "gold")
  })

  it("falls back to navy for uncurated countries", () => {
    assert.deepEqual(passportCoverDesign("ZZ"), DEFAULT_DESIGN)
    assert.equal(hasCuratedCover("ZZ"), false)
  })

  it("is case insensitive", () => {
    assert.deepEqual(passportCoverDesign("jp"), passportCoverDesign("JP"))
    assert.equal(hasCuratedCover("jp"), true)
  })

  it("always returns a usable colour and foil", () => {
    for (const code of ["FR", "JP", "NZ", "ZA", "ZZ", "US"]) {
      const design = passportCoverDesign(code)
      assert.match(design.cover, /^#[0-9a-f]{6}$/i)
      assert.ok(["gold", "silver"].includes(design.foil))
    }
  })
})
