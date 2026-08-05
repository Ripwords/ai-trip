import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { resolveSplits, splitsToMinorUnits, SPLIT_MODES } = await import("./splits")

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

describe("SPLIT_MODES", () => {
  it("is the four modes the schema accepts", () => {
    assert.deepEqual([...SPLIT_MODES], ["equal", "exact", "shares", "percent"])
  })
})

describe("resolveSplits — equal", () => {
  it("splits evenly when it divides exactly", () => {
    const r = resolveSplits({ amountMinor: 9000, mode: "equal", participantIds: ["a", "b", "c"] })
    assert.deepEqual(r, { a: 3000, b: 3000, c: 3000 })
  })

  // The whole reason splits are integers: 100.00 / 3 is 33.333..., and three
  // rounded thirds are 99.99 or 100.02 depending on which way you round. The
  // remainder has to be handed to real people, not dropped.
  it("hands the leftover cents to the earliest participants", () => {
    const r = resolveSplits({ amountMinor: 10000, mode: "equal", participantIds: ["a", "b", "c"] })
    assert.deepEqual(r, { a: 3334, b: 3333, c: 3333 })
    assert.equal(sum(r), 10000)
  })

  it("splits a single participant's expense entirely to them", () => {
    assert.deepEqual(resolveSplits({ amountMinor: 4999, mode: "equal", participantIds: ["a"] }), {
      a: 4999,
    })
  })

  it("reconciles exactly for every awkward amount across 2..7 people", () => {
    for (let n = 2; n <= 7; n++) {
      const ids = Array.from({ length: n }, (_, i) => `u${i}`)
      for (const amountMinor of [1, 7, 99, 100, 101, 3333, 99999, 1000003]) {
        const r = resolveSplits({ amountMinor, mode: "equal", participantIds: ids })
        assert.equal(sum(r), amountMinor, `${amountMinor} across ${n}`)
        // Nobody's share may differ from anyone else's by more than one unit.
        const values = Object.values(r)
        assert.ok(Math.max(...values) - Math.min(...values) <= 1, `${amountMinor} across ${n}`)
      }
    }
  })

  it("returns an empty map when there are no participants", () => {
    assert.deepEqual(resolveSplits({ amountMinor: 100, mode: "equal", participantIds: [] }), {})
  })
})

describe("resolveSplits — shares", () => {
  it("weights by share count", () => {
    const r = resolveSplits({
      amountMinor: 12000,
      mode: "shares",
      participantIds: ["a", "b", "c"],
      values: { a: 2, b: 1, c: 1 },
    })
    assert.deepEqual(r, { a: 6000, b: 3000, c: 3000 })
  })

  it("gives the remainder to the largest fractional part, not the first row", () => {
    // 1:2 over 10.00 is 3.333.. / 6.666.. — the leftover cent belongs to b,
    // whose fractional part is larger, even though a comes first.
    const r = resolveSplits({
      amountMinor: 1000,
      mode: "shares",
      participantIds: ["a", "b"],
      values: { a: 1, b: 2 },
    })
    assert.equal(sum(r), 1000)
    assert.deepEqual(r, { a: 333, b: 667 })
  })

  it("falls back to equal when every share is zero", () => {
    const r = resolveSplits({
      amountMinor: 900,
      mode: "shares",
      participantIds: ["a", "b", "c"],
      values: { a: 0, b: 0, c: 0 },
    })
    assert.deepEqual(r, { a: 300, b: 300, c: 300 })
  })
})

describe("resolveSplits — percent", () => {
  it("applies percentages and still reconciles to the cent", () => {
    const r = resolveSplits({
      amountMinor: 10000,
      mode: "percent",
      participantIds: ["a", "b", "c"],
      values: { a: 33.33, b: 33.33, c: 33.34 },
    })
    assert.equal(sum(r), 10000)
    assert.deepEqual(r, { a: 3333, b: 3333, c: 3334 })
  })

  it("normalises percentages that do not add to 100", () => {
    const r = resolveSplits({
      amountMinor: 6000,
      mode: "percent",
      participantIds: ["a", "b"],
      values: { a: 50, b: 150 },
    })
    assert.deepEqual(r, { a: 1500, b: 4500 })
  })
})

describe("resolveSplits — exact", () => {
  it("uses the given minor-unit amounts verbatim when they reconcile", () => {
    const r = resolveSplits({
      amountMinor: 5000,
      mode: "exact",
      participantIds: ["a", "b"],
      values: { a: 3500, b: 1500 },
    })
    assert.deepEqual(r, { a: 3500, b: 1500 })
  })

  it("throws when the exact amounts do not sum to the expense", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 5000,
          mode: "exact",
          participantIds: ["a", "b"],
          values: { a: 3500, b: 1000 },
        }),
      /must sum to/i,
    )
  })

  it("treats a participant with no entry as owing zero", () => {
    const r = resolveSplits({
      amountMinor: 5000,
      mode: "exact",
      participantIds: ["a", "b"],
      values: { a: 5000 },
    })
    assert.deepEqual(r, { a: 5000, b: 0 })
  })
})

describe("splitsToMinorUnits", () => {
  it("parses a stored splits map back to integers", () => {
    assert.deepEqual(splitsToMinorUnits({ a: "33.34", b: "33.33" }, "USD"), { a: 3334, b: 3333 })
  })

  it("drops entries that are not money rather than yielding NaN", () => {
    assert.deepEqual(splitsToMinorUnits({ a: "10.00", b: "oops" }, "USD"), { a: 1000 })
  })
})
