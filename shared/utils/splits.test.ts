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

  it("keeps a zero-weight participant at zero rather than dropping them", () => {
    const r = resolveSplits({
      amountMinor: 900,
      mode: "shares",
      participantIds: ["a", "b", "c"],
      values: { a: 1, b: 2, c: 0 },
    })
    assert.deepEqual(r, { a: 300, b: 600, c: 0 })
    assert.equal(sum(r), 900)
  })

  // Used to degrade to an equal split, which invents an allocation nobody
  // stated. An all-empty shares form is a mistake, not an instruction.
  it("throws when every share is zero instead of degrading to equal", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 900,
          mode: "shares",
          participantIds: ["a", "b", "c"],
          values: { a: 0, b: 0, c: 0 },
        }),
      /non-zero/i,
    )
  })

  // Negatives were silently clamped to 0, quietly rewriting the input.
  it("throws on a negative share rather than clamping it to zero", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 900,
          mode: "shares",
          participantIds: ["a", "b"],
          values: { a: 3, b: -1 },
        }),
      /negative/i,
    )
  })

  it("throws on a non-finite share", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 900,
          mode: "shares",
          participantIds: ["a", "b"],
          values: { a: 1, b: Number.NaN },
        }),
      /finite/i,
    )
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

  it("accepts a whole-number split that lands exactly on 100", () => {
    const r = resolveSplits({
      amountMinor: 10000,
      mode: "percent",
      participantIds: ["a", "b"],
      values: { a: 60, b: 40 },
    })
    assert.deepEqual(r, { a: 6000, b: 4000 })
  })

  // The bug: percentages were normalised by whatever they happened to total,
  // so 50 + 30 became 62.5 / 37.5 — silently reallocating the 20% the user
  // deliberately left unassigned. It must be rejected, not reinterpreted.
  it("throws when the percentages leave part of the expense unallocated", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 10000,
          mode: "percent",
          participantIds: ["a", "b"],
          values: { a: 50, b: 30 },
        }),
      /must sum to 100/i,
    )
  })

  it("does not produce the old rescaled 6250/3750 for 50 + 30", () => {
    let result: Record<string, number> | null = null
    try {
      result = resolveSplits({
        amountMinor: 10000,
        mode: "percent",
        participantIds: ["a", "b"],
        values: { a: 50, b: 30 },
      })
    } catch {
      result = null
    }
    assert.equal(result, null)
  })

  it("throws when the percentages overshoot 100", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 6000,
          mode: "percent",
          participantIds: ["a", "b"],
          values: { a: 50, b: 150 },
        }),
      /must sum to 100/i,
    )
  })

  it("tolerates float dust around 100", () => {
    const r = resolveSplits({
      amountMinor: 10000,
      mode: "percent",
      participantIds: ["a", "b", "c"],
      values: { a: 33.333, b: 33.333, c: 33.333 },
    })
    assert.equal(sum(r), 10000)
  })

  it("throws when every percentage is zero", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 6000,
          mode: "percent",
          participantIds: ["a", "b"],
          values: { a: 0, b: 0 },
        }),
      /must sum to 100/i,
    )
  })

  it("throws on a negative percentage", () => {
    assert.throws(
      () =>
        resolveSplits({
          amountMinor: 6000,
          mode: "percent",
          participantIds: ["a", "b"],
          values: { a: 110, b: -10 },
        }),
      /negative/i,
    )
  })

  it("allows a participant recorded at 0%", () => {
    const r = resolveSplits({
      amountMinor: 6000,
      mode: "percent",
      participantIds: ["a", "b", "c"],
      values: { a: 100, b: 0, c: 0 },
    })
    assert.deepEqual(r, { a: 6000, b: 0, c: 0 })
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
