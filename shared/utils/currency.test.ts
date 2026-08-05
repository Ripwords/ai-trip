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
  // ISO 4217 exponent 0. Getting this wrong is a 100x error on every amount in
  // the currency, not a rounding nit.
  it("contains only the currencies that genuinely have no minor unit", () => {
    for (const code of ["JPY", "KRW", "VND", "CLP", "ISK"]) {
      assert.ok(ZERO_DECIMAL_CURRENCIES.has(code), `missing ${code}`)
    }
  })

  // TWD (cents), IDR (sen) and HUF (fillér) are all ISO 4217 exponent 2. They
  // were listed as zero-decimal, which made every amount in them 100x wrong:
  // a NT$1,234.56 dinner parsed to 1234 minor units and rendered as "1234".
  it("does not claim TWD, IDR or HUF are zero-decimal", () => {
    for (const code of ["TWD", "IDR", "HUF"]) {
      assert.equal(ZERO_DECIMAL_CURRENCIES.has(code), false, `${code} has a minor unit`)
      assert.equal(currencyDecimals(code), 2)
    }
  })

  it("round-trips a two-decimal TWD amount through minor units", async () => {
    const { toMinorUnits, fromMinorUnits } = await import("./money")
    assert.equal(toMinorUnits("1234.56", "TWD"), 123456)
    assert.equal(fromMinorUnits(123456, "TWD"), "1234.56")
    assert.equal(formatCurrencyAmount(1234.56, "TWD"), "1234.56")
  })
})
