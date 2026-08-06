import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DOCK_SHEET_LIFTED_FRACTION,
  resolveDockSheetGeometry,
  type DockSheetGeometryInput,
} from "./useDockSheetGeometry"

/** A compact (bottom sheet) iPhone-shaped reading with the keyboard down. */
function input(over: Partial<DockSheetGeometryInput> = {}): DockSheetGeometryInput {
  return {
    isCompact: true,
    keyboardInset: 0,
    viewportHeight: 844,
    ...over,
  }
}

describe("resolveDockSheetGeometry", () => {
  it("leaves the >=768px side panel entirely to its utility classes", () => {
    // Inline styles beat `md:bottom-4` / `md:top-4` / `md:max-h-…`, so the
    // desktop panel must receive no inline geometry at all — not even a
    // resting one.
    assert.deepEqual(resolveDockSheetGeometry(input({ isCompact: false })), {})
    assert.deepEqual(resolveDockSheetGeometry(input({ isCompact: false, keyboardInset: 336 })), {})
  })

  it("sits on the screen edge with the keyboard down", () => {
    // At rest the element's own `bottom-0 max-h-[70dvh] min-h-[50dvh]` classes
    // do the work; the only thing inline is the safe-area pad, which is wanted
    // exactly when the sheet really is resting on the screen edge.
    assert.deepEqual(resolveDockSheetGeometry(input()), {
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
    })
  })

  it("lifts the sheet by exactly the keyboard inset, no more", () => {
    // THE geometry contract. `keyboardInset` is already the distance from the
    // layout viewport's bottom edge to the visual viewport's bottom edge
    // (innerHeight - visualHeight - offsetTop). `bottom` is resolved against
    // the layout viewport, so `bottom: inset` puts the sheet's bottom edge
    // flush on the top of the keyboard — no band of page in between.
    //
    // This is why the lift may NOT ride on `transform`: iOS additionally
    // offsets a *transformed* `position: fixed` element by
    // `visualViewport.offsetTop`, which would move the sheet by
    // `inset + offsetTop` and leave that surplus showing as a gap.
    const geometry = resolveDockSheetGeometry(input({ keyboardInset: 336, viewportHeight: 508 }))
    assert.equal(geometry.bottom, "336px")
  })

  it("caps the lifted sheet to the visible strip, not the layout viewport", () => {
    // `viewportHeight` is the visual viewport. With `bottom: inset` the sheet's
    // bottom edge is the visual viewport's bottom edge, so a max-height of
    // `usable` would fill the strip exactly; the fraction deliberately leaves a
    // sliver of page visible ABOVE the sheet, which is a top edge and never a
    // gap under it.
    const geometry = resolveDockSheetGeometry(input({ keyboardInset: 336, viewportHeight: 508 }))
    assert.equal(geometry.maxHeight, `${Math.round(508 * DOCK_SHEET_LIFTED_FRACTION)}px`)
    assert.ok(DOCK_SHEET_LIFTED_FRACTION <= 1, "the sheet must never exceed the visible strip")
  })

  it("drops the resting floor and the safe-area pad while lifted", () => {
    // With the keyboard up every pixel counts, and the keyboard already covers
    // the home-indicator area.
    const geometry = resolveDockSheetGeometry(input({ keyboardInset: 336, viewportHeight: 508 }))
    assert.equal(geometry.minHeight, "0px")
    assert.equal(geometry.paddingBottom, "0.5rem")
  })

  it("never sets a transform, so the sheet's entrance animation keeps it", () => {
    // The `sheet-up` enter/leave classes own `transform` outright. An inline
    // transform would beat them and the sheet would appear without sliding up.
    for (const inset of [0, 120, 336]) {
      const geometry: Record<string, unknown> = resolveDockSheetGeometry(
        input({ keyboardInset: inset }),
      )
      assert.equal(geometry.transform, undefined)
      assert.deepEqual(
        Object.keys(geometry).filter((k) => k.startsWith("--")),
        [],
        "no custom property may smuggle the lift back into a transform",
      )
    }
  })

  it("falls back to dvh sizing when the visual viewport is unmeasured", () => {
    const geometry = resolveDockSheetGeometry(input({ keyboardInset: 336, viewportHeight: 0 }))
    assert.equal(geometry.bottom, "336px")
    assert.equal(geometry.maxHeight, "70dvh")
  })

  it("treats a negative or zero inset as rest", () => {
    assert.equal(resolveDockSheetGeometry(input({ keyboardInset: -5 })).bottom, undefined)
    assert.equal(resolveDockSheetGeometry(input({ keyboardInset: 0 })).bottom, undefined)
  })
})
