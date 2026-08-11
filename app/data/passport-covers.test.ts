import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DEFAULT_DESIGN, hasCuratedCover, passportCoverDesign } from "./passport-covers"

describe("passport cover designs", () => {
  it("applies the EU burgundy standard to member states", () => {
    const france = passportCoverDesign("FR")

    assert.equal(france.cover, "#6d1f2b")
    assert.equal(france.supra, "EUROPEAN UNION")
    assert.equal(france.localWord, "PASSEPORT")
  })

  it("keeps Croatia blue, the documented exception to that standard", () => {
    const croatia = passportCoverDesign("HR")

    assert.notEqual(croatia.cover, passportCoverDesign("FR").cover)
    assert.equal(croatia.supra, "EUROPEAN UNION")
  })

  it("shares one design across Andean Community members", () => {
    const codes = ["BO", "CO", "EC", "PE"]
    const covers = new Set(codes.map((code) => passportCoverDesign(code).cover))

    assert.equal(covers.size, 1)
    assert.equal(passportCoverDesign("PE").supra, "COMUNIDAD ANDINA")
  })

  it("falls back to navy and gold for uncurated countries", () => {
    assert.deepEqual(passportCoverDesign("ZZ"), DEFAULT_DESIGN)
    assert.equal(hasCuratedCover("ZZ"), false)
  })

  it("is case insensitive", () => {
    assert.deepEqual(passportCoverDesign("jp"), passportCoverDesign("JP"))
    assert.equal(hasCuratedCover("jp"), true)
  })

  it("never returns an empty cover or foil", () => {
    for (const code of ["FR", "JP", "NZ", "ZA", "ZZ", "US"]) {
      const design = passportCoverDesign(code)
      assert.match(design.cover, /^#[0-9a-f]{6}$/i)
      assert.ok(["gold", "silver", "black", "white"].includes(design.foil))
    }
  })
})
