import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
}

/** ISO codes are machine data: people read the flag and the country name (U8). */
describe("country display (U8)", () => {
  it("shows the flag and name in the country detail panel, not the ISO code", () => {
    const panel = source("./CountryDetailPanel.vue")
    assert.doesNotMatch(panel, /\{\{\s*country\.alpha2\s*\}\}/)
    assert.equal(
      panel.match(/\{\{ countryFlag\(country\.alpha2\) \}\} \{\{ country\.name \}\}/g)?.length,
      2,
    )
  })

  it("shows the flag and name for each passport, not the ISO code", () => {
    const manager = source("./PassportManager.vue")
    assert.doesNotMatch(manager, /\{\{\s*passport\.countryCode\s*\}\}/)
    assert.equal(
      manager.match(
        /\{\{ countryFlag\(passport\.countryCode\) \}\} \{\{ countryName\(passport\.countryCode\) \}\}/g,
      )?.length,
      2,
    )
  })
})
