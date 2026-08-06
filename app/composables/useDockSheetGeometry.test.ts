import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DOCK_SHEET_LIFTED_FRACTION,
  DOCK_SHEET_RESTING_ANCHOR,
  resolveDockSheetGeometry,
  type DockSheetGeometryInput,
} from "./useDockSheetGeometry"

/** A compact (bottom sheet) iPhone-shaped reading with the keyboard down. */
function input(over: Partial<DockSheetGeometryInput> = {}): DockSheetGeometryInput {
  return {
    isCompact: true,
    keyboardInset: 0,
    viewportBottom: 844,
    viewportHeight: 844,
    ...over,
  }
}

/** iPhone 12/13/14 with the keyboard up and Safari scrolled to reveal the field. */
function lifted(over: Partial<DockSheetGeometryInput> = {}): DockSheetGeometryInput {
  // innerHeight 844, visualHeight 508, offsetTop 40 -> inset 296, bottom 548.
  return input({ keyboardInset: 296, viewportBottom: 548, viewportHeight: 508, ...over })
}

describe("resolveDockSheetGeometry", () => {
  it("leaves the >=768px side panel entirely to its utility classes", () => {
    // Inline styles beat `md:bottom-4` / `md:top-4` / `md:max-h-…`, so the
    // desktop panel must receive no inline geometry at all — not even a
    // resting one. (An inline `top` would also flip `data-vv-anchored` on and
    // hand the panel a `translateY(-100%)` it must never have.)
    assert.deepEqual(resolveDockSheetGeometry(input({ isCompact: false })), {})
    assert.deepEqual(resolveDockSheetGeometry(lifted({ isCompact: false })), {})
  })

  it("rests on the containing block's own bottom edge, without measuring it", () => {
    // `top: 100%` IS the bottom edge of a fixed element's containing block, by
    // definition — the anchor at rest needs no JS number to agree with Safari
    // about. Sizing stays with the element's `max-h-[70dvh] min-h-[50dvh]`
    // classes; the only other inline value is the safe-area pad, wanted exactly
    // when the sheet really is resting on the screen edge.
    assert.deepEqual(resolveDockSheetGeometry(input()), {
      top: "100%",
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
    })
    assert.equal(DOCK_SHEET_RESTING_ANCHOR, "100%")
  })

  it("anchors the sheet's top edge to the visual viewport's bottom edge", () => {
    // THE geometry contract. `viewportBottom` is
    // `visualViewport.offsetTop + visualViewport.height` — the visual
    // viewport's bottom edge measured from the LAYOUT viewport's top. Placing
    // the sheet's top edge there and pulling it up by its own height
    // (`translateY(-100%)` in AiDock.vue) puts its bottom edge exactly on the
    // keyboard, with no arithmetic left over to overshoot.
    assert.equal(resolveDockSheetGeometry(lifted()).top, "548px")
  })

  it("REGRESSION (#75/#76): never expresses the lift as a distance from the bottom", () => {
    // iOS Safari stops honouring `position: fixed` while the keyboard is up, so
    // an offset measured back from the viewport's bottom edge is measured from
    // an edge nothing is being pinned to any more. Both shipped attempts did
    // that — as a transform of `-inset` and then as `bottom: inset` — and both
    // left a gap that varied per open and grew across open/close cycles.
    //
    // Concretely: the inset here is 296, and 296 must appear NOWHERE in the
    // output. The sheet is placed at 548, from the top.
    for (const geometry of [
      resolveDockSheetGeometry(lifted()),
      resolveDockSheetGeometry(lifted({ keyboardInset: 336, viewportBottom: 508 })),
      resolveDockSheetGeometry(input()),
    ]) {
      const bag: Record<string, unknown> = geometry
      assert.equal(bag.bottom, undefined, "a `bottom`-based lift is the bug, not the fix")
      assert.equal(bag.transform, undefined, "an inline transform would kill the entrance slide")
      assert.deepEqual(
        Object.keys(bag).filter((k) => k.startsWith("--")),
        [],
        "no custom property may smuggle a bottom offset back in",
      )
    }
    assert.doesNotMatch(
      JSON.stringify(resolveDockSheetGeometry(lifted())),
      /296/,
      "the inset is a keyboard DETECTOR; it must never be used as a coordinate",
    )
  })

  it("caps the lifted sheet to the visible strip, not the layout viewport", () => {
    // `viewportHeight` is the visual viewport. With the top anchored to its
    // bottom edge the sheet grows UPWARD, so without a cap a tall transcript
    // would push the header off the top of the screen. The fraction is below 1
    // so a sliver of page stays visible above the sheet — a top edge, never the
    // gap under it that this module exists to prevent.
    const geometry = resolveDockSheetGeometry(lifted())
    assert.equal(geometry.maxHeight, `${Math.round(508 * DOCK_SHEET_LIFTED_FRACTION)}px`)
    assert.ok(DOCK_SHEET_LIFTED_FRACTION <= 1, "the sheet must never exceed the visible strip")
  })

  it("drops the resting floor and the safe-area pad while lifted", () => {
    // With the keyboard up every pixel counts, and the keyboard already covers
    // the home-indicator area.
    const geometry = resolveDockSheetGeometry(lifted())
    assert.equal(geometry.minHeight, "0px")
    assert.equal(geometry.paddingBottom, "0.5rem")
  })

  it("keeps dvh sizing when the visual viewport height is unmeasured", () => {
    const geometry = resolveDockSheetGeometry(lifted({ viewportHeight: 0 }))
    assert.equal(geometry.top, "548px")
    assert.equal(geometry.maxHeight, "70dvh")
  })

  it("falls back to rest rather than to a half-computed anchor", () => {
    // A keyboard verdict with no usable viewport reading (or a nonsense one)
    // must not produce a position — resting is always safe.
    for (const bad of [0, -10, Number.NaN]) {
      assert.deepEqual(resolveDockSheetGeometry(lifted({ viewportBottom: bad })), {
        top: "100%",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
      })
    }
  })

  it("treats a negative or zero inset as rest", () => {
    assert.equal(resolveDockSheetGeometry(input({ keyboardInset: -5 })).top, "100%")
    assert.equal(resolveDockSheetGeometry(input({ keyboardInset: 0 })).top, "100%")
    assert.equal(resolveDockSheetGeometry(input({ keyboardInset: 0 })).minHeight, undefined)
  })

  it("rounds the anchor to whole pixels", () => {
    assert.equal(resolveDockSheetGeometry(lifted({ viewportBottom: 547.6 })).top, "548px")
  })

  it("reduces to resting behaviour on Android, where the layout viewport shrinks", () => {
    // `interactive-widget=resizes-content`: innerHeight drops to match
    // vv.height and offsetTop stays 0, so `resolveKeyboardInset` reports 0 and
    // the sheet rests on the (now shorter) containing block's bottom edge —
    // above the keyboard, with `dvh` doing the sizing exactly as before.
    const android = resolveDockSheetGeometry(
      input({ keyboardInset: 0, viewportBottom: 500, viewportHeight: 500 }),
    )
    assert.equal(android.top, "100%")
    assert.equal(android.maxHeight, undefined, "70dvh keeps the job on Android")

    // And an Android browser that does NOT resize the layout viewport lands on
    // the same formula as iOS: offsetTop 0 + visualHeight 500 = 500.
    assert.equal(
      resolveDockSheetGeometry(
        input({ keyboardInset: 344, viewportBottom: 500, viewportHeight: 500 }),
      ).top,
      "500px",
    )
  })
})
