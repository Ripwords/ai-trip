import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const appDir = fileURLToPath(new URL(".", import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (entry.name.endsWith(".test.ts")) return []
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

const files = sourceFiles(appDir).map((path) => ({
  name: relative(appDir, path),
  source: readFileSync(path, "utf8"),
}))

/** The scoped <style> blocks of a single-file component, comments removed. */
function scopedStyles(source: string): string {
  return [...source.matchAll(/<style\b[^>]*\bscoped\b[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, ""))
    .join("\n")
}

/**
 * Colours from the retired warm sand/terra palette and the navy map chrome
 * that went with it. Hard-coded copies of these bypass the theme tokens, so
 * they keep showing the old look after a retheme. rgba() values are matched
 * on their channels with spacing normalised.
 */
const RETIRED_HEX = new Set([
  // sand (light + dark ramps) and the dark card surface
  "faf8f5",
  "f3efe8",
  "e8e0d4",
  "d4c8b8",
  "b8a78f",
  "9f8b6f",
  "8a7458",
  "6e5c46",
  "5a4b3a",
  "3d3328",
  "1a1714",
  "23201b",
  "302b24",
  "433b30",
  "1e1b18",
  // terra
  "fef4f0",
  "fde6dc",
  "fbc9b8",
  "f7a48a",
  "f07b5a",
  "e85d3a",
  "d44425",
  "b0341b",
  "8e2c1a",
  "6b2416",
  // navy map chrome
  "1e3050",
  "0c1524",
  "1e3044",
  "162840",
  "1a3a5c",
  "c8d6e5",
  // Lagoon (sea-teal + slate), replaced by the Google Maps palette
  "0e7c86",
  "0a636b",
  "138892",
  "2a98a2",
  "72c4cb",
  "a9dde1",
  "d3eef0",
  "eaf6f7",
  "5fa8ad",
  "74b6ba",
  "13262b",
  "263b41",
  "3f565d",
  "56707a",
  "6f8489",
  "93a4a8",
  "c3d0d2",
  "dbe4e5",
  "e9eff0",
  "f4f7f7",
  "172023",
  "1d2629",
  "2c3a3e",
  "e2533b",
  "c4432d",
  "c4e1e4",
])
const RETIRED_RGB = new Set([
  "26,23,20",
  "30,27,24",
  "35,32,27",
  "61,51,40",
  "240,123,90",
  "232,93,58",
  "212,200,184",
  "110,92,70",
  "250,248,245",
  "243,239,232",
  "12,21,36",
  "10,15,26",
  "20,40,60",
  "30,48,68",
  "42,68,96",
  // Lagoon
  "14,124,134",
  "19,38,43",
  "29,38,41",
  "23,32,35",
  "95,168,173",
])

function retiredColours(source: string): string[] {
  const found = new Set<string>()
  for (const m of source.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = m[1]!.toLowerCase()
    if (RETIRED_HEX.has(hex)) found.add(`#${hex}`)
  }
  for (const m of source.matchAll(/%23([0-9a-fA-F]{6})\b/g)) {
    const hex = m[1]!.toLowerCase()
    if (RETIRED_HEX.has(hex)) found.add(`%23${hex}`)
  }
  for (const m of source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    const rgb = `${m[1]},${m[2]},${m[3]}`
    if (RETIRED_RGB.has(rgb)) found.add(`rgb(${rgb})`)
  }
  return [...found]
}

describe("theme palette", () => {
  it("keeps the descendant in scoped `.dark` selectors instead of letting :global() drop it", () => {
    // Vue compiles `:global(.dark) .x {}` to a bare `.dark {}`: the rule lands
    // on <html> and the component it was written for never sees it.
    const offenders = files
      .filter((f) => /:global\([^)]*\)\s*[^\s{,]/.test(scopedStyles(f.source)))
      .map((f) => f.name)
    assert.deepEqual(offenders, [])
  })

  it("leaves no retired warm or navy colours hard-coded outside the theme tokens", () => {
    const offenders = files
      .filter((f) => !f.name.startsWith("assets/"))
      .map((f) => ({ file: f.name, colours: retiredColours(f.source) }))
      .filter((f) => f.colours.length > 0)
    assert.deepEqual(offenders, [])
  })
})
