import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { ZERO_DECIMAL_CURRENCIES, currencyDecimals, formatCurrencyAmount } =
  await import("./currency")

describe("currencyDecimals", () => {
  it("returns 0 for zero-decimal currencies regardless of case", () => {
    assert.equal(currencyDecimals("JPY"), 0)
    assert.equal(currencyDecimals("jpy"), 0)
    assert.equal(currencyDecimals("KRW"), 0)
  })

  it("returns 2 for decimal currencies", () => {
    assert.equal(currencyDecimals("USD"), 2)
    assert.equal(currencyDecimals("EUR"), 2)
  })
})

describe("formatCurrencyAmount", () => {
  it("formats zero-decimal currencies as whole units", () => {
    assert.equal(formatCurrencyAmount(1500.4, "JPY"), "1500")
  })

  it("formats decimal currencies with two decimals", () => {
    assert.equal(formatCurrencyAmount(12.5, "USD"), "12.50")
  })
})

describe("ZERO_DECIMAL_CURRENCIES", () => {
  it("contains the ISO 4217 zero-decimal set used across the app", () => {
    for (const code of ["JPY", "KRW", "VND", "IDR", "TWD", "CLP", "ISK", "HUF"]) {
      assert.ok(ZERO_DECIMAL_CURRENCIES.has(code), `missing ${code}`)
    }
  })
})
