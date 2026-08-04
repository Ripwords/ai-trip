import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { guardCostEstimate } = await import("./cost-guard")

function deps(overrides: {
  rate?: number | null
  derived?: string | null
  derivedCalls?: string[]
}) {
  return {
    getRate: async () => overrides.rate ?? null,
    deriveCost: async (placeId: string) => {
      overrides.derivedCalls?.push(placeId)
      return overrides.derived ?? null
    },
  }
}

describe("guardCostEstimate free meals", () => {
  // The food types had min: 1 USD, so a genuinely free item — hotel breakfast,
  // an included tasting, a street festival — was treated as an AI scale error
  // and nulled out. Attractions and parks already allowed 0.
  for (const type of ["restaurant", "cafe", "bar"]) {
    it(`keeps a zero-cost ${type}`, async () => {
      const result = await guardCostEstimate(
        { costEstimate: 0, type, placeId: null, currencyCode: "JPY" },
        deps({ rate: 150 }),
      )
      assert.equal(result, "0")
    })
  }

  it("still rejects an implausibly large restaurant estimate", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 5_000_000, type: "restaurant", placeId: null, currencyCode: "JPY" },
      deps({ rate: 150 }),
    )
    assert.equal(result, null)
  })
})

describe("guardCostEstimate", () => {
  it("keeps a plausible estimate, formatted for the currency", async () => {
    // 1500 JPY at rate 150 → $10 USD-equivalent, inside restaurant bounds.
    const result = await guardCostEstimate(
      { costEstimate: 1500, type: "restaurant", placeId: null, currencyCode: "JPY" },
      deps({ rate: 150 }),
    )
    assert.equal(result, "1500")
  })

  it("keeps a free attraction (0 is within attraction bounds)", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 0, type: "park", placeId: null, currencyCode: "JPY" },
      deps({ rate: 150 }),
    )
    assert.equal(result, "0")
  })

  it("rejects a wrong-scale estimate and falls back to Google price data", async () => {
    // 15 JPY for a restaurant ≈ $0.10 — below the $1 floor. Google knows better.
    const derivedCalls: string[] = []
    const result = await guardCostEstimate(
      { costEstimate: 15, type: "restaurant", placeId: "place-1", currencyCode: "JPY" },
      deps({ rate: 150, derived: "1800", derivedCalls }),
    )
    assert.equal(result, "1800")
    assert.deepEqual(derivedCalls, ["place-1"])
  })

  it("stores null when implausible and Google has no price data", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 15, type: "restaurant", placeId: "place-1", currencyCode: "JPY" },
      deps({ rate: 150, derived: null }),
    )
    assert.equal(result, null)
  })

  it("stores null when implausible and there is no placeId", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 999999, type: "cafe", placeId: null, currencyCode: "USD" },
      deps({ rate: 1 }),
    )
    assert.equal(result, null)
  })

  it("accepts the AI value untouched when the FX rate is unavailable", async () => {
    // Never null everything because Frankfurter is down.
    const result = await guardCostEstimate(
      { costEstimate: 15, type: "restaurant", placeId: "place-1", currencyCode: "JPY" },
      deps({ rate: null }),
    )
    assert.equal(result, "15")
  })

  it("formats decimal currencies with two decimals", async () => {
    const result = await guardCostEstimate(
      { costEstimate: 12.5, type: "cafe", placeId: null, currencyCode: "USD" },
      deps({ rate: 1 }),
    )
    assert.equal(result, "12.50")
  })
})
