import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveDockAnchorTop } from "./dock-anchor"

describe("resolveDockAnchorTop", () => {
  it("places the layer at the scroll offset when the containing block is the ICB", () => {
    // No positioned ancestor: `position: absolute` resolves against the initial
    // containing block, which is anchored at the DOCUMENT origin. So the layer's
    // `top` is simply the current scroll offset and it lands on the viewport's
    // top edge without the page moving at all.
    assert.equal(resolveDockAnchorTop({ scrollY: 0, containingBlockTop: 0 }), 0)
    assert.equal(resolveDockAnchorTop({ scrollY: 1840, containingBlockTop: 0 }), 1840)
  })

  it("subtracts a positioned ancestor's own document offset", () => {
    // If the dock is ever mounted inside a `position: relative` ancestor, `top`
    // is measured from that ancestor's padding box, not the document.
    assert.equal(resolveDockAnchorTop({ scrollY: 1840, containingBlockTop: 240 }), 1600)
  })

  it("rounds to whole pixels", () => {
    assert.equal(resolveDockAnchorTop({ scrollY: 1840.4, containingBlockTop: 0.1 }), 1840)
  })

  it("falls back to the top of the containing block rather than to NaN", () => {
    assert.equal(resolveDockAnchorTop({ scrollY: Number.NaN, containingBlockTop: 0 }), 0)
  })

  it("never lets a keyboard inset leak into the anchor", () => {
    // REGRESSION GUARD for #75/#76/#77. The anchor is a document coordinate. If
    // some keyboard-derived offset were ever folded in here, the layer would
    // start moving relative to the page again — which is the failure mode this
    // redesign exists to delete. Scrolling the page by N must move the anchor by
    // exactly N, and by nothing else.
    for (const scrollY of [0, 17, 1840]) {
      assert.equal(
        resolveDockAnchorTop({ scrollY: scrollY + 336, containingBlockTop: 0 }) -
          resolveDockAnchorTop({ scrollY, containingBlockTop: 0 }),
        336,
      )
    }
  })
})
