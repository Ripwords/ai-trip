import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  countries,
  countryByAlpha2,
  countryCenter,
  countryCurrency,
  countryZoom,
  isCountryCode,
} from "./countries"

describe("country enrichment", () => {
  it("gives every country a sane centroid", () => {
    for (const c of countries) {
      assert.equal(typeof c.lat, "number", `${c.alpha2} missing lat`)
      assert.equal(typeof c.lng, "number", `${c.alpha2} missing lng`)
      assert.ok(c.lat >= -90 && c.lat <= 90, `${c.alpha2} lat out of range: ${c.lat}`)
      assert.ok(c.lng >= -180 && c.lng <= 180, `${c.alpha2} lng out of range: ${c.lng}`)
      assert.notEqual(c.lat, 0, `${c.alpha2} lat must not be 0 (placeholder)`)
      assert.notEqual(c.lng, 0, `${c.alpha2} lng must not be 0 (placeholder)`)
    }
  })

  it("gives every country a reasonable initial zoom", () => {
    for (const c of countries) {
      assert.ok(c.zoom >= 3 && c.zoom <= 10, `${c.alpha2} zoom out of range: ${c.zoom}`)
    }
  })

  it("gives every country an ISO 4217 currency code", () => {
    for (const c of countries) {
      assert.equal(typeof c.currency, "string", `${c.alpha2} missing currency`)
      assert.match(c.currency, /^[A-Z]{3}$/, `${c.alpha2} bad currency: ${c.currency}`)
    }
  })
})

describe("countryByAlpha2 lookup", () => {
  it("returns the country for a known code", () => {
    const jp = countryByAlpha2.get("JP")
    assert.ok(jp)
    assert.equal(jp.currency, "JPY")
    assert.equal(jp.name, "Japan")
  })

  it("returns undefined for unknown codes", () => {
    assert.equal(countryByAlpha2.get("ZZ"), undefined)
  })
})

describe("currency derivation edge cases", () => {
  it("maps eurozone members to EUR", () => {
    assert.equal(countryByAlpha2.get("FR")?.currency, "EUR")
    assert.equal(countryByAlpha2.get("DE")?.currency, "EUR")
    assert.equal(countryByAlpha2.get("IT")?.currency, "EUR")
    assert.equal(countryByAlpha2.get("ES")?.currency, "EUR")
  })

  it("maps UK to GBP, not regional variants", () => {
    assert.equal(countryByAlpha2.get("GB")?.currency, "GBP")
  })

  it("maps territories that circulate USD to USD", () => {
    assert.equal(countryByAlpha2.get("EC")?.currency, "USD")
    assert.equal(countryByAlpha2.get("PR")?.currency, "USD")
  })

  it("maps common travel destinations correctly", () => {
    assert.equal(countryByAlpha2.get("JP")?.currency, "JPY")
    assert.equal(countryByAlpha2.get("KR")?.currency, "KRW")
    assert.equal(countryByAlpha2.get("TH")?.currency, "THB")
    assert.equal(countryByAlpha2.get("SG")?.currency, "SGD")
    assert.equal(countryByAlpha2.get("AU")?.currency, "AUD")
    assert.equal(countryByAlpha2.get("CA")?.currency, "CAD")
    assert.equal(countryByAlpha2.get("MY")?.currency, "MYR")
    assert.equal(countryByAlpha2.get("ID")?.currency, "IDR")
    assert.equal(countryByAlpha2.get("VN")?.currency, "VND")
    assert.equal(countryByAlpha2.get("PH")?.currency, "PHP")
    assert.equal(countryByAlpha2.get("IN")?.currency, "INR")
    assert.equal(countryByAlpha2.get("CN")?.currency, "CNY")
    assert.equal(countryByAlpha2.get("TW")?.currency, "TWD")
    assert.equal(countryByAlpha2.get("US")?.currency, "USD")
  })
})

describe("helper accessors", () => {
  it("countryCenter returns lat/lng for known code", () => {
    const c = countryCenter("JP")
    assert.ok(c)
    assert.equal(typeof c.lat, "number")
    assert.equal(typeof c.lng, "number")
  })

  it("countryCenter returns null for unknown code", () => {
    assert.equal(countryCenter("ZZ"), null)
    assert.equal(countryCenter(null), null)
  })

  it("countryCurrency returns currency for known code", () => {
    assert.equal(countryCurrency("JP"), "JPY")
  })

  it("countryCurrency returns null for unknown code", () => {
    assert.equal(countryCurrency("ZZ"), null)
    assert.equal(countryCurrency(null), null)
  })

  it("countryZoom returns zoom for known code", () => {
    assert.equal(typeof countryZoom("JP"), "number")
  })

  it("isCountryCode validates known codes", () => {
    assert.equal(isCountryCode("JP"), true)
    assert.equal(isCountryCode("US"), true)
    assert.equal(isCountryCode("ZZ"), false)
    assert.equal(isCountryCode(""), false)
    assert.equal(isCountryCode(null), false)
  })
})
