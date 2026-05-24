import assert from "node:assert/strict"
import { describe, it } from "node:test"

// Reproduce the parser inline (don't import the script — its top level runs
// against the DB on load).
import { countries } from "../../app/data/countries"

const NAME_ALIASES: Record<string, string> = {
  USA: "US",
  "U.S.A.": "US",
  "United States of America": "US",
  UK: "GB",
  "U.K.": "GB",
  Britain: "GB",
  "Great Britain": "GB",
  "South Korea": "KR",
  "North Korea": "KP",
  Russia: "RU",
  "Russian Federation": "RU",
  Vietnam: "VN",
  "Viet Nam": "VN",
  Czechia: "CZ",
  "Czech Republic": "CZ",
  UAE: "AE",
  "Hong Kong SAR": "HK",
  Macao: "MO",
  "Macao SAR": "MO",
  "Taiwan, Province of China": "TW",
  "Republic of China": "TW",
  "Palestine, State of": "PS",
  "Côte d'Ivoire": "CI",
  "Ivory Coast": "CI",
}

const nameToCode = new Map<string, string>()
for (const c of countries) nameToCode.set(c.name.toLowerCase(), c.alpha2)
for (const [name, code] of Object.entries(NAME_ALIASES)) {
  nameToCode.set(name.toLowerCase(), code)
}

function extractCountryFromAddress(address: string | null): string | null {
  if (!address) return null
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const last = segments.at(-1)
  if (!last) return null
  const candidates = [last, last.replace(/[\d\-\s]+$/, "").trim()]
  for (const cand of candidates) {
    const code = nameToCode.get(cand.toLowerCase())
    if (code) return code
  }
  return null
}

describe("extractCountryFromAddress", () => {
  it("matches the exact country name at the end", () => {
    assert.equal(extractCountryFromAddress("1-1 Chiyoda, Tokyo, Japan"), "JP")
    assert.equal(extractCountryFromAddress("Times Square, New York, NY, United States"), "US")
    assert.equal(extractCountryFromAddress("Champs-Élysées, Paris, France"), "FR")
  })

  it("strips trailing postal code segments", () => {
    assert.equal(extractCountryFromAddress("Shibuya, Tokyo 150-0001, Japan"), "JP")
    assert.equal(extractCountryFromAddress("SW1A 1AA, United Kingdom"), "GB")
  })

  it("uses aliases for common variants", () => {
    assert.equal(extractCountryFromAddress("Manhattan, NY, USA"), "US")
    assert.equal(extractCountryFromAddress("Westminster, UK"), "GB")
    assert.equal(extractCountryFromAddress("Hanoi, Vietnam"), "VN")
    assert.equal(extractCountryFromAddress("Prague, Czechia"), "CZ")
    assert.equal(extractCountryFromAddress("Dubai, UAE"), "AE")
  })

  it("returns null on null/empty/unknown", () => {
    assert.equal(extractCountryFromAddress(null), null)
    assert.equal(extractCountryFromAddress(""), null)
    assert.equal(extractCountryFromAddress("Somewhere, Atlantis"), null)
  })
})
