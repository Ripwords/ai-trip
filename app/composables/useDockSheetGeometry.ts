/**
 * The AI dock's bottom-sheet geometry, as a pure function of the settled
 * keyboard reading.
 *
 * Kept out of the component so the one thing that cannot be checked in CI — the
 * arithmetic that decides where the sheet's bottom edge lands relative to the
 * keyboard — is at least pinned by unit tests. The *look* still needs a real
 * iPhone; iOS Safari's keyboard does not exist in headless Chrome.
 *
 * ── Why the anchor is `top`, and never `bottom` ─────────────────────
 * Two shipped attempts moved this sheet by computing an inset —
 * `innerHeight - visualViewport.height - visualViewport.offsetTop` — and
 * applying it as `transform: translate3d(0, -inset, 0)` (PR #75) and then as
 * `bottom: inset` (PR #76). Both left a band of blurred page between the sheet
 * and the keyboard, of a size that varied per open and grew across open/close
 * cycles.
 *
 * They failed for the same underlying reason. **iOS Safari does not honour
 * `position: fixed` while the virtual keyboard is up** — fixed elements start
 * behaving like statically positioned ones, resolved against the document and
 * scrolling with it rather than being pinned to a viewport edge. So the whole
 * premise of "offset the element from the viewport's bottom edge" is gone:
 * `bottom` is being resolved against an edge Safari has stopped honouring, and
 * the residual error tracks whatever scroll offset happens to be in play. That
 * is exactly the "different every open, worse every cycle" symptom.
 *
 * The documented workaround is to stop expressing the position as a distance
 * from the bottom at all, and instead anchor the element's TOP edge:
 *
 *     el.style.top = `${visualViewport.offsetTop + visualViewport.height}px`
 *     .dock-sheet { position: fixed; transform: translateY(-100%) }
 *
 * `visualViewport.offsetTop + visualViewport.height` is the visual viewport's
 * bottom edge expressed in layout-viewport coordinates — measured from the TOP,
 * the one origin that does not move. The sheet's top edge is placed there and
 * the permanent `translateY(-100%)` pulls it up by exactly its own height, so
 * its bottom edge lands on the visual viewport's bottom edge *by construction*.
 * There is no inset arithmetic left to overshoot and nothing to accumulate.
 *
 * Refs:
 * - https://medium.com/@im_rahul/safari-and-position-fixed-978122be5f29
 * - https://www.bram.us/2021/09/13/prevent-items-from-being-hidden-underneath-the-virtual-keyboard-by-means-of-the-virtualkeyboard-api/
 * - https://mathix.dev/blog/fix-html-elements-on-top-of-the-ios-keyboard-using-html-css-js
 * - https://iifx.dev/en/articles/460201403/debugging-ios-26-how-to-correct-fixed-positioning-post-keyboard-interaction
 *
 * ── Why the resting anchor is `100%`, not `innerHeight` ─────────────
 * The anchor is live at rest too, so the keyboard lift is a plain transition of
 * one property (`top`) rather than a switch between two positioning schemes,
 * which could not be animated. At rest the correct anchor is the layout
 * viewport's own bottom edge, and `top: 100%` *is* that edge by definition —
 * a percentage resolved against the fixed element's containing block. Writing
 * `window.innerHeight` there instead would re-introduce a JS-measured number
 * that has to agree with Safari's containing block, and betting on that
 * agreement is what has already failed twice. `top` interpolates across the
 * percentage/pixel boundary, so the lift still animates as one motion.
 *
 * A stale `visualViewport.offsetTop` (iOS 26 does not reliably reset it) can
 * therefore never displace the resting sheet: the resting anchor does not read
 * the visual viewport at all.
 *
 * ── The transform collision ─────────────────────────────────────────
 * `.dock-sheet` also has `sheet-up-*` enter/leave classes that own `transform`
 * for the slide-in. The permanent `translateY(-100%)` collides with them head
 * on, and PR #75 lost its entrance animation to exactly this. The resolution
 * lives in AiDock.vue's stylesheet: while anchored, the entrance endpoints are
 * rewritten in the anchored frame (`translateY(0)` → `translateY(-100%)`)
 * instead of the unanchored one (`translateY(100%)` → `translateY(0)`). Same
 * travel — one sheet height, upward — composed arithmetically at the endpoints
 * rather than by one declaration clobbering the other.
 *
 * The inline style object below still must not carry a `transform`: inline
 * styles beat classes, so one here would kill the entrance outright. The type
 * does not admit it, and it does not admit `bottom` either — a `bottom`-based
 * lift is the specific regression this module exists to prevent, so bringing it
 * back is a compile error rather than a review miss.
 */

/**
 * How much of the visible strip the lifted sheet may occupy. Below 1 so a
 * sliver of the page still shows ABOVE the sheet — that is a top edge, and is
 * never the gap this module exists to prevent. The bottom edge is pinned flush
 * by the `top` anchor regardless of this value.
 */
export const DOCK_SHEET_LIFTED_FRACTION = 0.92

/** The resting anchor: the containing block's own bottom edge, by definition. */
export const DOCK_SHEET_RESTING_ANCHOR = "100%"

export interface DockSheetGeometryInput {
  /**
   * False at >=768px, where the dock is a right-anchored side panel positioned
   * entirely by `md:` utility classes that inline styles would beat.
   */
  isCompact: boolean
  /**
   * Settled keyboard inset in CSS px from `resolveKeyboardInset`. Only its
   * sign is used here — it is the "is the keyboard up" verdict, carrying all of
   * that function's guards (pinch-zoom, blur, iOS 26 offsetTop staleness). The
   * position itself comes from `viewportBottom`, never from this number.
   */
  keyboardInset: number
  /**
   * `visualViewport.offsetTop + visualViewport.height`: the visual viewport's
   * bottom edge in layout-viewport coordinates. 0 when unmeasured.
   */
  viewportBottom: number
  /** Visual-viewport height in CSS px; 0 when it has not been measured yet. */
  viewportHeight: number
}

/**
 * The inline style object for `.dock-sheet`.
 *
 * Deliberately narrow. `transform` is absent because the `sheet-up` enter/leave
 * classes own it and an inline one would kill the entrance animation; `bottom`
 * is absent because a `bottom`-based lift is the shipped regression this module
 * replaces. Adding either is a compile error.
 *
 * A type alias rather than an `interface` so TypeScript grants it an implicit
 * index signature and it stays assignable to Vue's `StyleValue`.
 */
export type DockSheetGeometry = {
  top?: string
  maxHeight?: string
  minHeight?: string
  paddingBottom?: string
}

export function resolveDockSheetGeometry(input: DockSheetGeometryInput): DockSheetGeometry {
  if (!input.isCompact) return {}

  // At rest the element's own `max-h-[70dvh] min-h-[50dvh]` classes are
  // correct, so the only sizing is the safe-area pad. The anchor is still set,
  // so the lift below is a transition of one property rather than a switch of
  // positioning scheme.
  const resting: DockSheetGeometry = {
    top: DOCK_SHEET_RESTING_ANCHOR,
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
  }

  if (!(input.keyboardInset > 0)) return resting

  // A keyboard verdict without a usable measurement cannot be positioned
  // against; resting is the safe answer, never a half-computed anchor.
  const usable = input.viewportHeight
  const anchor = input.viewportBottom
  if (!(anchor > 0) || !Number.isFinite(anchor)) return resting

  return {
    // The visual viewport's bottom edge, measured from the layout viewport's
    // top. `translateY(-100%)` in the stylesheet puts the sheet's BOTTOM edge
    // here. See the module comment.
    top: `${Math.round(anchor)}px`,
    // The sheet's bottom edge is pinned and it grows upward, so it also has to
    // fit inside the visible strip or its header leaves the top of the screen.
    // Transitioned on the same duration and curve as `top` (see AiDock.vue) so
    // both edges move as one motion.
    maxHeight: usable > 0 ? `${Math.round(usable * DOCK_SHEET_LIFTED_FRACTION)}px` : "70dvh",
    // With the keyboard up, every pixel counts: drop the resting floor.
    minHeight: "0px",
    // The keyboard already covers the home-indicator area.
    paddingBottom: "0.5rem",
  }
}
