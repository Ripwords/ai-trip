import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createExpenseSchema, moneyString, updateExpenseSchema, updateTripSchema } from "./schemas"

describe("moneyString", () => {
  it("accepts plain and two-decimal amounts", () => {
    for (const v of ["0", "0.00", "12", "12.5", "12.50", "99999999.99"]) {
      assert.equal(moneyString.safeParse(v).success, true, `expected ${v} to parse`)
    }
  })

  // `amount: z.string()` let all of these through to Postgres, which threw
  // `invalid input syntax for type numeric` / `numeric field overflow` and
  // surfaced as an unhandled 500 rather than a 400.
  it("rejects values that are not decimal money", () => {
    for (const v of ["", " ", "abc", "1e40", "NaN", "Infinity", "1,000", "$12", "12.345", "--5"]) {
      assert.equal(moneyString.safeParse(v).success, false, `expected ${v} to be rejected`)
    }
  })

  it("rejects negative amounts, which silently corrupted every total", () => {
    for (const v of ["-50", "-0.01"]) {
      assert.equal(moneyString.safeParse(v).success, false, `expected ${v} to be rejected`)
    }
  })

  it("rejects values wider than the numeric(10,2) column", () => {
    assert.equal(moneyString.safeParse("123456789.00").success, false)
  })
})

describe("createExpenseSchema", () => {
  it("rejects a non-numeric amount instead of passing it to the database", () => {
    const result = createExpenseSchema.safeParse({ description: "Lunch", amount: "abc" })
    assert.equal(result.success, false)
  })

  it("rejects a negative amount", () => {
    const result = createExpenseSchema.safeParse({ description: "Lunch", amount: "-20.00" })
    assert.equal(result.success, false)
  })

  it("accepts a well-formed expense", () => {
    const result = createExpenseSchema.safeParse({
      description: "Lunch",
      amount: "20.00",
      category: "food",
    })
    assert.equal(result.success, true)
  })
})

describe("updateExpenseSchema", () => {
  it("rejects an empty body rather than returning 200 for a no-op", () => {
    assert.equal(updateExpenseSchema.safeParse({}).success, false)
  })

  it("accepts a single-field update", () => {
    assert.equal(updateExpenseSchema.safeParse({ description: "Dinner" }).success, true)
  })

  it("still validates amount on update", () => {
    assert.equal(updateExpenseSchema.safeParse({ amount: "-1" }).success, false)
  })
})

describe("updateTripSchema", () => {
  // currencyCode used to be writable here, which bypassed the locked,
  // transactional conversion in convert-currency.post.ts and silently
  // reinterpreted every stored amount at 1:1.
  it("does not accept currencyCode", () => {
    const result = updateTripSchema.safeParse({ currencyCode: "JPY" })
    assert.equal(result.success, true, "unknown keys are stripped, not rejected")
    assert.equal("currencyCode" in (result.success ? result.data : {}), false)
  })

  it("still accepts the fields a trip edit legitimately changes", () => {
    const result = updateTripSchema.safeParse({ name: "Japan", budget: "1000" })
    assert.equal(result.success, true)
  })

  it("validates budget as money", () => {
    assert.equal(updateTripSchema.safeParse({ budget: "abc" }).success, false)
    assert.equal(updateTripSchema.safeParse({ budget: "-5" }).success, false)
    assert.equal(updateTripSchema.safeParse({ budget: null }).success, true)
  })
})
