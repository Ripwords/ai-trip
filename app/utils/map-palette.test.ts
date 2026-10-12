import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { MAP_PALETTE, mapPalette } from "./map-palette"

describe("map palette", () => {
  it("uses Google Maps' water and land in light mode", () => {
    assert.equal(MAP_PALETTE.light.water, "#aadaff")
    assert.equal(MAP_PALETTE.light.land, "#f8f9fa")
  })

  it("keeps land distinct from water in dark mode, so continents stay readable", () => {
    assert.notEqual(MAP_PALETTE.dark.land, MAP_PALETTE.dark.water)
    assert.notEqual(MAP_PALETTE.dark.land, "#212b2e")
  })

  it("defines the same colours for both themes", () => {
    assert.deepEqual(Object.keys(MAP_PALETTE.dark).sort(), Object.keys(MAP_PALETTE.light).sort())
  })

  it("picks the palette for the current theme", () => {
    assert.equal(mapPalette(true), MAP_PALETTE.dark)
    assert.equal(mapPalette(false), MAP_PALETTE.light)
  })
})

describe("maps drawn in CSS follow the shared palette", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
  const varIn = (block: string, name: string) =>
    block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1]
  const blockAfter = (source: string, selector: string) =>
    source.slice(source.indexOf(`${selector} {`)).split("}")[0]!

  it("2D scratch map", () => {
    const source = read("../components/ScratchMap.vue")
    for (const [selector, p] of [
      [".scratch-map", MAP_PALETTE.light],
      [".dark .scratch-map", MAP_PALETTE.dark],
    ] as const) {
      const block = blockAfter(source, selector)
      assert.equal(varIn(block, "map-ocean"), p.water, selector)
      assert.equal(varIn(block, "map-country"), p.land, selector)
      assert.equal(varIn(block, "map-country-hover"), p.landHover, selector)
      assert.equal(varIn(block, "map-border"), p.border, selector)
      assert.equal(varIn(block, "map-visited"), p.visited, selector)
      assert.equal(varIn(block, "map-layover"), p.layover, selector)
      assert.equal(varIn(block, "map-want"), p.want, selector)
    }
  })

  it("travel-history route map", () => {
    const source = read("../components/PassportHero.vue")
    for (const [selector, p] of [
      [".passport-shell", MAP_PALETTE.light],
      [".dark .passport-shell", MAP_PALETTE.dark],
    ] as const) {
      const block = blockAfter(source, selector)
      assert.equal(varIn(block, "passport-water"), p.water, selector)
      assert.equal(varIn(block, "passport-land"), p.land, selector)
      assert.equal(varIn(block, "passport-border"), p.border, selector)
      assert.equal(varIn(block, "passport-route"), p.route, selector)
    }
  })
})
