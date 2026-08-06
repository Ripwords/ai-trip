/**
 * Where the mobile AI dock's full-screen layer sits in the DOCUMENT.
 *
 * ── Why there is no viewport math here at all ────────────────────────
 * Three shipped attempts moved the dock's bottom sheet so its composer would
 * clear the iOS keyboard: `bottom: <inset>` (#76), `transform: translate3d(0,
 * -inset, 0)` (#75) and finally `top: offsetTop + visualHeight` with
 * `translateY(-100%)` (#77). The last one measured exact in headless Chrome —
 * 0.00px of error — and was still visibly wrong on an iPhone.
 *
 * They share two root causes, both confirmed from device screenshots on
 * iOS 26:
 *
 * 1. **iOS does not honour `position: fixed` while the keyboard is open.**
 *    Fixed elements degrade toward `static`: they resolve against the document
 *    and scroll with it instead of being pinned to a viewport edge. Every fix
 *    above adjusted a property (`bottom`, `transform`, `top`) on an element
 *    whose positioning model Safari had already abandoned, so the correction
 *    was applied in a coordinate space that no longer existed.
 *
 * 2. **The floating accessory bar (the ^ / v / Done pill) is NOT part of
 *    `visualViewport.height`.** So even a perfectly anchored sheet — bottom
 *    edge exactly on `visualViewport.offsetTop + visualViewport.height` — stops
 *    ABOVE that pill and leaves a visible strip of page between the composer
 *    and the keyboard. No amount of visual-viewport anchoring can close that
 *    gap, because the target itself is unreachable through that API.
 *
 * The conclusion is not "measure harder". It is that a viewport-pinned element
 * is the wrong shape for this UI on iOS. So the mobile dock stops being one:
 * it is a full-screen layer in normal document flow, `position: absolute`,
 * `height: 100dvh`, anchored to a DOCUMENT coordinate. Nothing is pinned to a
 * viewport edge, so iOS has nothing to mis-place; the composer is simply the
 * last element of a flex column and the browser's own "scroll the focused
 * input into view" does the work, exactly as it does on any ordinary page.
 * A gap under the composer cannot open up, because there is no gap to
 * compute — the browser scrolls the whole layer, accessory bar included.
 *
 * The one number this module owns is that document coordinate.
 *
 * ── Why a document coordinate rather than `top: 0` ───────────────────
 * `position: absolute` resolves against the nearest positioned ancestor, or
 * the initial containing block (which is anchored at the DOCUMENT origin, not
 * the viewport). `top: 0` would therefore park the layer at the top of the
 * page and leave it invisible whenever the trip page is scrolled. Placing it
 * at the scroll offset the dock opened at makes it cover the viewport without
 * moving the page by a single pixel — and, being a document coordinate, it
 * stays correct while iOS scrolls the document to reveal the composer.
 *
 * ── Why the answer is now almost always 0 ────────────────────────────
 * #78 shipped and overshot: iOS scrolled the composer ~190px PAST the keyboard,
 * because an `absolute` layer over the full trip page leaves thousands of
 * pixels of scroll range and nothing caps how far a scroll-into-view travels.
 * So the trip page is now taken out of layout while the layer is open and the
 * document is exactly one viewport tall — which clamps `scrollY` to 0, and with
 * it this anchor.
 *
 * The function stays a function of scroll position anyway. It is measured after
 * the collapse rather than assumed, so a dock mounted somewhere with a
 * positioned ancestor, or a page whose wrapper is not collapsible, still lands
 * on the viewport instead of silently at `top: 0` of an unrelated box.
 */

export interface DockAnchorInput {
  /** `window.scrollY` at the moment the dock opened. */
  scrollY: number
  /**
   * The document-space top of the layer's containing block: 0 for the initial
   * containing block (no positioned ancestor), otherwise the offset parent's
   * `getBoundingClientRect().top + window.scrollY`. Subtracting it keeps the
   * anchor correct no matter where the dock is mounted in the page.
   */
  containingBlockTop: number
}

/**
 * The `top` for the full-screen mobile layer, in its containing block's
 * coordinates, such that its top edge lands on the viewport's top edge.
 *
 * Deliberately a function of scroll position only. It reads no `visualViewport`
 * property, by design: see the module comment — visual-viewport anchoring is
 * the model this redesign removes, not one it refines.
 */
export function resolveDockAnchorTop(input: DockAnchorInput): number {
  const top = input.scrollY - input.containingBlockTop
  return Number.isFinite(top) ? Math.round(top) : 0
}
