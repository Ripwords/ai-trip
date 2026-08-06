import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  KEYBOARD_MIN_INSET_PX,
  resolveKeyboardInset,
  resolveViewportBottom,
  type ViewportSample,
} from "./useKeyboardInset"

/** An iPhone-shaped sample with nothing covering the viewport. */
function sample(over: Partial<ViewportSample> = {}): ViewportSample {
  return {
    innerHeight: 844,
    visualHeight: 844,
    offsetTop: 0,
    scale: 1,
    composerFocused: null,
    ...over,
  }
}

describe("resolveKeyboardInset", () => {
  it("is zero when nothing covers the viewport", () => {
    assert.equal(resolveKeyboardInset(sample()), 0)
  })

  it("reports the hidden strip when the iOS keyboard overlays the page", () => {
    // iOS: layout viewport keeps its full height, the visual viewport shrinks.
    assert.equal(resolveKeyboardInset(sample({ visualHeight: 508, composerFocused: true })), 336)
  })

  it("subtracts offsetTop when Safari scrolls the visual viewport on focus", () => {
    // Focusing an input near the bottom makes Safari slide the visual viewport
    // down inside the layout viewport; only what is left below it is hidden.
    assert.equal(
      resolveKeyboardInset(sample({ visualHeight: 508, offsetTop: 40, composerFocused: true })),
      296,
    )
  })

  it("rounds to whole pixels", () => {
    assert.equal(resolveKeyboardInset(sample({ visualHeight: 507.6, composerFocused: true })), 336)
  })

  it("never reads pinch-zoom as a keyboard", () => {
    // Zooming also shrinks visualViewport.height; without the scale gate the
    // sheet would be shoved around by a pinch.
    assert.equal(
      resolveKeyboardInset(sample({ visualHeight: 400, scale: 2, composerFocused: true })),
      0,
    )
  })

  it("is ~0 on Android, where the layout viewport shrinks with the keyboard", () => {
    // `interactive-widget=resizes-content`: innerHeight drops AND vv.height
    // matches it, so there is no hidden strip and `dvh` does all the work.
    assert.equal(
      resolveKeyboardInset(sample({ innerHeight: 500, visualHeight: 500, composerFocused: true })),
      0,
    )
  })

  it("ignores a stale offsetTop once the keyboard is gone (iOS 26)", () => {
    // iOS 26 leaves visualViewport.offsetTop non-zero after dismissal. The
    // visual viewport is back to full height, so nothing is covered — the
    // leftover scroll must not read as a phantom keyboard.
    assert.equal(resolveKeyboardInset(sample({ offsetTop: 120, composerFocused: true })), 0)
  })

  it("returns to rest as soon as the composer loses focus, whatever the viewport says", () => {
    // The dismissal escape hatch: if nothing is focused there is no keyboard,
    // even when iOS is still reporting a shrunken/scrolled visual viewport.
    assert.equal(
      resolveKeyboardInset(sample({ visualHeight: 508, offsetTop: 40, composerFocused: false })),
      0,
    )
  })

  it("still works with visualViewport as the only signal", () => {
    // Browsers/paths where focus is unknown must keep the measured behaviour.
    assert.equal(resolveKeyboardInset(sample({ visualHeight: 508, composerFocused: null })), 336)
  })

  it("treats sub-keyboard strips as rest, not as a tiny lift", () => {
    // A handful of pixels of chrome or rounding is not a keyboard, and lifting
    // by it would produce visible jitter.
    assert.equal(
      resolveKeyboardInset(
        sample({ visualHeight: 844 - (KEYBOARD_MIN_INSET_PX - 1), composerFocused: true }),
      ),
      0,
    )
    assert.equal(
      resolveKeyboardInset(sample({ visualHeight: 844 - KEYBOARD_MIN_INSET_PX })),
      KEYBOARD_MIN_INSET_PX,
    )
  })

  it("never returns more than the layout viewport", () => {
    assert.equal(resolveKeyboardInset(sample({ visualHeight: 10, offsetTop: -500 })), 844)
  })

  it("survives non-finite readings", () => {
    assert.equal(resolveKeyboardInset(sample({ visualHeight: Number.NaN })), 0)
  })
})

describe("resolveViewportBottom", () => {
  it("is the visual viewport's bottom edge, measured from the layout viewport's top", () => {
    // The one origin iOS does not move while the keyboard is up. This — not the
    // inset — is what the dock's `top` is set to.
    assert.equal(resolveViewportBottom(sample({ visualHeight: 508, offsetTop: 40 })), 548)
  })

  it("equals the layout viewport height when nothing is covering the page", () => {
    // Rest, and Android with a genuinely shrunken layout viewport: the anchor
    // reduces to the containing block's own bottom edge.
    assert.equal(resolveViewportBottom(sample()), 844)
    assert.equal(resolveViewportBottom(sample({ innerHeight: 500, visualHeight: 500 })), 500)
  })

  it("adds offsetTop rather than subtracting it", () => {
    // The sign is the whole bug. The inset SUBTRACTS offsetTop because it walks
    // back from the bottom; the anchor ADDS it because it walks down from the
    // top. Getting this backwards reproduces PR #75's growing gap exactly.
    const scrolled = resolveViewportBottom(sample({ visualHeight: 508, offsetTop: 40 }))
    const unscrolled = resolveViewportBottom(sample({ visualHeight: 508, offsetTop: 0 }))
    assert.ok(scrolled > unscrolled, "scrolling the visual viewport down moves the anchor down")
    assert.equal(scrolled - unscrolled, 40)
  })

  it("survives non-finite readings", () => {
    assert.equal(resolveViewportBottom(sample({ visualHeight: Number.NaN })), 0)
  })
})
