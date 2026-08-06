/**
 * iOS-shaped virtual-keyboard simulation for a desktop browser engine.
 *
 * WHAT THIS MODELS
 * ----------------
 * On iOS Safari the virtual keyboard does NOT change the layout viewport:
 *   - `window.innerHeight` stays the same
 *   - `100dvh` stays the same (dvh tracks retractable browser chrome, not the
 *     keyboard)
 *   - no `resize` event fires on `window`
 *   - `visualViewport.height` shrinks by the keyboard's height, and
 *     `visualViewport.offsetTop` may become non-zero
 *   - `resize` (and possibly `scroll`) fire on `window.visualViewport`
 *
 * So resizing the Playwright viewport is the WRONG simulation: it shrinks
 * `innerHeight` and `dvh` too, which is Android/Chrome behaviour, and it would
 * make a `100dvh` layer appear to work when on iOS it does not.
 *
 * Instead this shadows `height`/`offsetTop` on the live `VisualViewport`
 * instance with own properties and fires its events, leaving every layout-
 * viewport quantity untouched — an exact match for the observable API surface
 * iOS presents.
 *
 * WHAT THIS DOES NOT MODEL
 * ------------------------
 *   - The engine's own "scroll the focused element into view". On iOS that is
 *     native behaviour no override can produce. It is a faithful omission for
 *     the state under test: since #79 the document is exactly one viewport tall
 *     while the dock is open, so there is zero scroll range for the engine to
 *     use — which is precisely the reported symptom ("the chatbox doesn't
 *     scroll up"). The harness asserts that zero-scroll-range invariant so the
 *     omission stays honest.
 *   - iOS's floating accessory bar (the ^ / v / Done pill), which sits BELOW
 *     `visualViewport.height` and is not exposed to any web API.
 *   - Keyboard animation timing, interactive-widget modes, and pinch-zoom
 *     (which also moves the visual viewport).
 */

export type KeyboardWindow = Window & {
  __simulateKeyboard?: (keyboardHeightPx: number, offsetTopPx?: number) => void
  __keyboardSimInstalled?: boolean
}

/**
 * Runs INSIDE the page. Installs `window.__simulateKeyboard(height, offsetTop)`.
 * Serialised by Playwright, so it must be self-contained.
 */
export function installKeyboardSim(): void {
  const w = window as KeyboardWindow
  if (w.__keyboardSimInstalled) return
  const vv = window.visualViewport
  if (!vv) throw new Error("visualViewport unavailable in this engine")

  let keyboard = 0
  let offsetTop = 0

  // Derived from `innerHeight` on every read rather than from a value snapshot
  // at install time: with the keyboard DOWN, iOS reports a visual viewport
  // exactly as tall as the layout viewport, and `innerHeight` is the quantity
  // the keyboard leaves alone. (Snapshotting `vv.height` at init also picks up
  // whatever pre-layout value the engine happens to have.)
  Object.defineProperty(vv, "height", {
    configurable: true,
    get: () => window.innerHeight - keyboard,
  })
  Object.defineProperty(vv, "offsetTop", {
    configurable: true,
    get: () => offsetTop,
  })

  w.__simulateKeyboard = (keyboardHeightPx: number, offsetTopPx = 0) => {
    keyboard = keyboardHeightPx
    offsetTop = offsetTopPx
    // iOS fires these on the visual viewport only. It deliberately does NOT
    // fire `resize` on `window`, so neither does this.
    vv.dispatchEvent(new Event("resize"))
    vv.dispatchEvent(new Event("scroll"))
  }
  w.__keyboardSimInstalled = true
}

/** Runs INSIDE the page. Geometry the assertions are made against. */
export function readDockGeometry(): {
  composerBottom: number
  visualViewportBottom: number
  visualViewportHeight: number
  layerHeight: number
  layerTop: number
  innerHeight: number
  scrollY: number
  scrollHeight: number
} {
  const composer = document.querySelector(".dock-input-area")
  const layer = document.querySelector(".dock-sheet")
  if (!composer || !layer) throw new Error("dock is not open")
  const vv = window.visualViewport
  if (!vv) throw new Error("visualViewport unavailable")
  const composerRect = composer.getBoundingClientRect()
  const layerRect = layer.getBoundingClientRect()
  return {
    // getBoundingClientRect is in LAYOUT-viewport coordinates, and the visual
    // viewport's bottom edge in those same coordinates is offsetTop + height.
    composerBottom: composerRect.bottom,
    visualViewportBottom: vv.offsetTop + vv.height,
    visualViewportHeight: vv.height,
    layerHeight: layerRect.height,
    layerTop: layerRect.top,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
  }
}
