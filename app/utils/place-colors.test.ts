import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { PLACE_GROUP_STYLE, placeGroup, placeStyle } from "./place-colors"

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe("place colours", () => {
  it("groups every activity type the app produces the way Google Maps colours them", () => {
    assert.equal(placeGroup("attraction"), "sight")
    assert.equal(placeGroup("museum"), "sight")
    assert.equal(placeGroup("entertainment"), "sight")
    assert.equal(placeGroup("restaurant"), "food")
    assert.equal(placeGroup("cafe"), "food")
    assert.equal(placeGroup("bar"), "food")
    assert.equal(placeGroup("hotel"), "stay")
    assert.equal(placeGroup("spa"), "stay")
    assert.equal(placeGroup("park"), "park")
    assert.equal(placeGroup("nature"), "park")
    assert.equal(placeGroup("transport"), "transit")
    assert.equal(placeGroup("shopping"), "shop")
  })

  it("falls back to a neutral grey for unknown or missing types", () => {
    assert.equal(placeGroup("bowling alley"), "other")
    assert.equal(placeGroup(null), "other")
    assert.equal(placeStyle(undefined), PLACE_GROUP_STYLE.other)
  })

  it("keeps a white pin glyph legible on every marker colour", () => {
    for (const [group, style] of Object.entries(PLACE_GROUP_STYLE)) {
      assert.ok(contrast(style.hex, "#ffffff") >= 3, `${group} ${style.hex}`)
    }
  })

  it("gives every group a distinct marker colour", () => {
    const hexes = Object.values(PLACE_GROUP_STYLE).map((s) => s.hex.toLowerCase())
    assert.equal(new Set(hexes).size, hexes.length)
  })

  it("is the only place-type colour map: components read it instead of keeping their own", () => {
    for (const file of [
      "../components/ActivityCard.vue",
      "../components/TripStats.vue",
      "../components/TripOverview.vue",
      "../components/TripMap.vue",
      "../components/TripOverviewMap.vue",
    ]) {
      const source = read(file)
      assert.doesNotMatch(source, /\brestaurant:\s*"/, `${file} defines its own type colours`)
      assert.match(source, /placeStyle\(/, `${file} does not use placeStyle()`)
    }
  })
})
