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

  it("accepts a calendar date and keeps it as one", () => {
    const result = createExpenseSchema.safeParse({
      description: "Lunch",
      amount: "20.00",
      paidAt: "2026-08-04",
    })
    assert.equal(result.success, true)
    assert.equal(result.success && result.data.paidAt, "2026-08-04")
  })

  // Legacy clients sent `new Date(d).toISOString()`; keep accepting that, but
  // store only the date part so it can't reintroduce the timezone shift.
  it("narrows a legacy ISO timestamp to its date part", () => {
    const result = createExpenseSchema.safeParse({
      description: "Lunch",
      amount: "20.00",
      paidAt: "2026-08-04T00:00:00.000Z",
    })
    assert.equal(result.success && result.data.paidAt, "2026-08-04")
  })

  it("rejects a paidAt that is not a date", () => {
    const result = createExpenseSchema.safeParse({
      description: "Lunch",
      amount: "20.00",
      paidAt: "yesterday",
    })
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

// Both of these were accepted by the schema and are exploitable: the sum check
// downstream passes, and the corrupted result is written to the `splits`
// column as if the user had asked for it.
describe("createExpenseSchema — adversarial split input", () => {
  const base = { description: "Taxi", amount: "100.00" }

  // A $100 expense split { a: 20000, b: -10000 } sums to 10000 minor units, so
  // `exact` mode's reconciliation check passes — and it books a $200 debt to A
  // and a $100 *credit* to B, inventing $100 owed to whoever posted it.
  it("rejects negative split values", () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      splitMode: "exact",
      participantIds: ["a", "b"],
      splitValues: { a: 200, b: -100 },
    })
    assert.equal(result.success, false, "a negative share must not be accepted")
  })

  it("still accepts a zero share", () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      splitMode: "exact",
      participantIds: ["a", "b"],
      splitValues: { a: 100, b: 0 },
    })
    assert.equal(result.success, true)
  })

  // `resolveSplits` computes weights from the array but returns a Record keyed
  // by user id, so duplicates collapse *after* the weights are computed: an
  // equal split of 9000 across ["a","a","b"] resolves to { a: 3000, b: 3000 }
  // and destroys 3000 minor units outright.
  it("rejects duplicate participant ids", () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      participantIds: ["a", "a", "b"],
    })
    assert.equal(result.success, false, "a duplicated participant must not be accepted")
  })

  it("accepts a distinct participant list", () => {
    const result = createExpenseSchema.safeParse({ ...base, participantIds: ["a", "b"] })
    assert.equal(result.success, true)
  })
})
