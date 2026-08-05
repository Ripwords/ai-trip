import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { toMinorUnits, fromMinorUnits, minorUnitsFromNumber, sumMinorUnits, multiplyMinorUnits } =
  await import("./money")

describe("toMinorUnits", () => {
  it("parses a two-decimal amount exactly", () => {
    assert.equal(toMinorUnits("10.35", "USD"), 1035)
    assert.equal(toMinorUnits("0.01", "USD"), 1)
    assert.equal(toMinorUnits("100", "USD"), 10000)
  })

  it("parses zero-decimal currencies as whole units", () => {
    assert.equal(toMinorUnits("3200", "JPY"), 3200)
    assert.equal(toMinorUnits("3200.00", "JPY"), 3200)
  })

  // parseFloat("0.29") * 100 is 28.999999999999996 — |Math.round| hides it for
  // one value and not the next. Parsing the digits directly cannot drift.
  it("does not drift on values that float multiplication rounds wrong", () => {
    for (const [text, minor] of [
      ["0.29", 29],
      ["1.005", 100], // truncates the third decimal rather than rounding up
      ["8.20", 820],
      ["1.10", 110],
      ["4.35", 435],
    ] as const) {
      assert.equal(toMinorUnits(text, "USD"), minor, `${text} -> ${minor}`)
    }
  })

  it("handles negatives and surrounding whitespace", () => {
    assert.equal(toMinorUnits("-12.50", "USD"), -1250)
    assert.equal(toMinorUnits("  7.05  ", "USD"), 705)
  })

  it("returns null for values that are not money", () => {
    for (const bad of ["", "abc", "1.2.3", "NaN", "1e3"]) {
      assert.equal(toMinorUnits(bad, "USD"), null, bad)
    }
  })
})

describe("fromMinorUnits", () => {
  it("renders a DB-ready numeric string at the currency's precision", () => {
    assert.equal(fromMinorUnits(1035, "USD"), "10.35")
    assert.equal(fromMinorUnits(5, "USD"), "0.05")
    assert.equal(fromMinorUnits(-1250, "USD"), "-12.50")
    assert.equal(fromMinorUnits(3200, "JPY"), "3200")
  })

  it("round-trips through toMinorUnits", () => {
    for (const v of ["0.01", "999.99", "12345.60"]) {
      assert.equal(fromMinorUnits(toMinorUnits(v, "USD") ?? 0, "USD"), v)
    }
  })
})

describe("minorUnitsFromNumber", () => {
  it("rounds a float to the nearest minor unit", () => {
    assert.equal(minorUnitsFromNumber(10.345, "USD"), 1035)
    assert.equal(minorUnitsFromNumber(3200.4, "JPY"), 3200)
  })
})

describe("sumMinorUnits", () => {
  it("adds integers with no drift", () => {
    assert.equal(sumMinorUnits([10, 20, 29]), 59)
    assert.equal(sumMinorUnits([]), 0)
  })
})

describe("multiplyMinorUnits", () => {
  it("converts between currencies at a rate, rounding to the target precision", () => {
    // 10.00 USD at 150.25 -> 1502.5 JPY -> 1503 (JPY has no minor unit)
    assert.equal(multiplyMinorUnits(1000, "USD", 150.25, "JPY"), 1503)
    // 3200 JPY at 0.0062 -> 19.84 EUR
    assert.equal(multiplyMinorUnits(3200, "JPY", 0.0062, "EUR"), 1984)
  })

  it("is identity at rate 1 within the same currency", () => {
    assert.equal(multiplyMinorUnits(1035, "USD", 1, "USD"), 1035)
  })
})
