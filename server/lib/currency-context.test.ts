import assert from "node:assert/strict"
import { describe, it } from "node:test"

const { buildCurrencyCtx, costAnchorHint } = await import("./currency-context")

describe("buildCurrencyCtx", () => {
  it("computes local anchors from the USD rate for zero-decimal currencies", () => {
    const ctx = buildCurrencyCtx("JPY", 150)
    assert.ok(ctx.includes("1 USD ≈ 150 JPY"))
    assert.ok(ctx.includes("coffee ~750"))
    assert.ok(ctx.includes("casual lunch ~1,500–3,000"))
    assert.ok(ctx.includes("whole units"))
    assert.ok(ctx.includes("MUST be in JPY"))
  })

  it("computes anchors for decimal currencies and shows a 2dp rate under 10", () => {
    const ctx = buildCurrencyCtx("EUR", 0.9)
    assert.ok(ctx.includes("1 USD ≈ 0.90 EUR"))
    assert.ok(ctx.includes("MUST be in EUR"))
    assert.ok(!ctx.includes("whole units"))
  })

  it("falls back to static hints when the rate is unavailable", () => {
    const ctx = buildCurrencyCtx("JPY", null)
    assert.ok(ctx.includes("~1500, not 15"))
    assert.ok(ctx.includes("MUST be in JPY"))
  })

  it("rejects non-finite or non-positive rates", () => {
    assert.ok(buildCurrencyCtx("JPY", 0).includes("~1500, not 15"))
    assert.ok(buildCurrencyCtx("JPY", Number.NaN).includes("~1500, not 15"))
  })

  it("defaults to USD when no code is given", () => {
    assert.ok(buildCurrencyCtx(undefined, null).includes("MUST be in USD"))
  })
})

describe("costAnchorHint", () => {
  it("embeds the rate and a lunch anchor when the rate is known", () => {
    const hint = costAnchorHint("VND", 26000)
    assert.ok(hint.includes("1 USD ≈ 26,000 VND"))
    assert.ok(hint.includes("390,000 VND"))
  })

  it("falls back to the static hint when the rate is unknown", () => {
    const hint = costAnchorHint("JPY", null)
    assert.ok(hint.includes("Cost per visit in JPY"))
    assert.ok(hint.includes("zero-decimal"))
  })
})
