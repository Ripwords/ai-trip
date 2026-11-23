import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { PLACE_GROUP_STYLE, pinColors, placeGroup, placeStyle } from "./place-colors"

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

  it("falls back to the sight colour for unknown or missing types", () => {
    assert.equal(placeGroup("bowling alley"), "sight")
    assert.equal(placeGroup(null), "sight")
    assert.equal(placeStyle(undefined), PLACE_GROUP_STYLE.sight)
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

describe("pinColors", () => {
  it("keeps every pin as-is on a light map", () => {
    for (const style of Object.values(PLACE_GROUP_STYLE)) {
      assert.deepEqual(pinColors(style.hex, false), { fill: style.hex, text: "#ffffff" })
    }
  })

  it("turns grey pins light on the dark map, where grey on grey disappears", () => {
    assert.deepEqual(pinColors(PLACE_GROUP_STYLE.other.hex, true), {
      fill: "#f4efe6",
      text: "#1c1810",
    })
    assert.equal(pinColors("#a9a59c", true).fill, "#f4efe6")
  })

  it("keeps coloured pins coloured on the dark map", () => {
    for (const group of ["sight", "food", "stay", "park", "transit", "shop"] as const) {
      const hex = PLACE_GROUP_STYLE[group].hex
      assert.deepEqual(pinColors(hex, true), { fill: hex, text: "#ffffff" })
    }
  })
})
