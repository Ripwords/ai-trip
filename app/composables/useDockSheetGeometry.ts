/**
 * The AI dock's bottom-sheet geometry, as a pure function of the settled
 * keyboard reading.
 *
 * Kept out of the component so the one thing that cannot be checked in CI — the
 * arithmetic that decides where the sheet's bottom edge lands relative to the
 * keyboard — is at least pinned by unit tests. The *look* still needs a real
 * iPhone; iOS Safari's keyboard does not exist in headless Chrome.
 *
 * ── Why the lift is `bottom` and not `transform` ────────────────────
 * It rode on `transform: translate3d(0, var(--dock-lift), 0)` for one release
 * (PR #75), for a defensible reason: a compositor-only property does not force
 * layout on every frame of the keyboard animation. It was wrong on the target
 * device.
 *
 * On iOS, a `position: fixed` element that has a transform is no longer
 * resolved against the layout viewport the way an untransformed one is —
 * Safari additionally offsets it by `visualViewport.offsetTop`. So a sheet
 * asked to move by `inset` actually moved by `inset + offsetTop`, and the
 * surplus showed as a band of blurred page between the sheet's bottom edge and
 * the keyboard. Because `offsetTop` depends on how far Safari scrolled the
 * visual viewport to reveal the focused field, the band was a different size
 * every time — and because iOS 26 does not reliably reset `offsetTop` on
 * dismissal (see the staleness guard in `useKeyboardInset`), it grew across
 * open/close cycles.
 *
 * Subtracting `offsetTop` from the transform is NOT the fix: that trades a
 * geometry bug for a calibration against a value iOS is documented not to
 * reset, and it would drift in exactly the accumulating way users already saw.
 *
 * `bottom` resolves against the layout viewport, which is the frame
 * `keyboardInset` is already expressed in (`innerHeight - visualHeight -
 * offsetTop`). `bottom` and `max-height` are both animatable, so the sheet
 * still runs one transition rather than sampling iOS's; it costs main-thread
 * layout for the length of that transition, which is the correct trade when
 * the compositor path is geometrically wrong here.
 *
 * A second, independent reason not to go back: the `sheet-up` enter/leave
 * classes own `transform` for the open/close slide. Inline styles beat classes,
 * so any inline transform silently kills the sheet's entrance animation.
 */

/**
 * How much of the visible strip the lifted sheet may occupy. Below 1 so a
 * sliver of the page still shows ABOVE the sheet — that is a top edge, and is
 * never the gap this module exists to prevent. The bottom edge is pinned flush
 * by `bottom` regardless of this value.
 */
export const DOCK_SHEET_LIFTED_FRACTION = 0.92

export interface DockSheetGeometryInput {
  /**
   * False at >=768px, where the dock is a right-anchored side panel positioned
   * entirely by `md:` utility classes that inline styles would beat.
   */
  isCompact: boolean
  /**
   * Settled keyboard inset in CSS px: how much of the layout viewport's bottom
   * the keyboard covers. 0 means the keyboard is down.
   */
  keyboardInset: number
  /** Visual-viewport height in CSS px; 0 when it has not been measured yet. */
  viewportHeight: number
}

/**
 * The inline style object for `.dock-sheet`. Deliberately narrow: every
 * property here is animatable, and `transform` is absent by construction —
 * adding one would be a compile error, not just a review miss.
 *
 * A type alias rather than an `interface` so TypeScript grants it an implicit
 * index signature and it stays assignable to Vue's `StyleValue`.
 */
export type DockSheetGeometry = {
  bottom?: string
  maxHeight?: string
  minHeight?: string
  paddingBottom?: string
}

export function resolveDockSheetGeometry(input: DockSheetGeometryInput): DockSheetGeometry {
  if (!input.isCompact) return {}

  // At rest the element's own `bottom-0 max-h-[70dvh] min-h-[50dvh]` classes
  // are correct, so nothing is set inline but the safe-area pad. Leaving
  // `bottom` unset also means the `md:bottom-4` class still wins if the media
  // query flips before `isCompact` catches up.
  if (!(input.keyboardInset > 0)) {
    return { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }
  }

  const usable = input.viewportHeight || 0
  return {
    // Flush against the top of the keyboard. See the module comment.
    bottom: `${input.keyboardInset}px`,
    // The sheet is pinned to the bottom and grows upward, so it also has to
    // shrink or its header leaves the top of the screen. Transitioned on the
    // same duration and curve as `bottom` (see AiDock.vue) so both edges move
    // as one motion.
    maxHeight: usable > 0 ? `${Math.round(usable * DOCK_SHEET_LIFTED_FRACTION)}px` : "70dvh",
    // With the keyboard up, every pixel counts: drop the resting floor.
    minHeight: "0px",
    // The keyboard already covers the home-indicator area.
    paddingBottom: "0.5rem",
  }
}
