import { onMounted, onUnmounted, ref } from "vue"

/**
 * How many CSS pixels at the bottom of the layout viewport are covered by
 * something the browser does not account for in `dvh` — in practice, the iOS
 * virtual keyboard.
 *
 * Why this is needed even though the app sets
 * `interactive-widget=resizes-content`:
 *
 * That meta value is a Chrome/Android feature. **iOS Safari ignores it.** On
 * iOS the keyboard is composited over the page: the layout viewport keeps its
 * full height, `100dvh` keeps reporting the full screen, and a
 * `position: fixed; bottom: 0` panel therefore sits *behind* the keyboard. A
 * bottom sheet sized in `dvh` looks correct in Chrome DevTools and in headless
 * Chrome, and is still broken on a real iPhone — which is exactly what happened
 * to the AI dock.
 *
 * `visualViewport` is the only cross-browser signal for this. On Android, where
 * the layout viewport really does shrink, the computed inset is ~0 and the
 * `dvh` sizing continues to do the work, so applying this is harmless there.
 *
 * ── Sample vs. animate ──────────────────────────────────────────────
 * This composable deliberately does NOT publish every measurement. iOS emits
 * `visualViewport` events irregularly while the keyboard animates — sometimes a
 * burst, sometimes two, sometimes only one at the very end — so a consumer that
 * re-styles on every event *samples* Apple's animation instead of running its
 * own, and lurches in whatever coarse steps iOS happened to report. That is the
 * "not smooth, not consistent" the dock had.
 *
 * Instead the keyboard is treated as a binary open/closed state: the transition
 * is committed once, promptly, and the consumer animates to the settled target
 * with its own CSS transition (see `LIFT_MS`).
 */

/**
 * One reading of the viewport, plus whether a text field holds focus. Split out
 * from the DOM so the resolution rules are a pure function that can be tested
 * without a browser — which matters here, because the behaviour this guards
 * against cannot be reproduced in headless Chrome at all.
 */
export interface ViewportSample {
  /** `window.innerHeight` — the layout viewport. */
  innerHeight: number
  /** `visualViewport.height`. */
  visualHeight: number
  /** `visualViewport.offsetTop`. */
  offsetTop: number
  /** `visualViewport.scale`. */
  scale: number
  /**
   * Whether a text-entry element holds focus. `null` when that signal is not
   * available, in which case the viewport measurement is trusted on its own.
   */
  composerFocused: boolean | null
}

/**
 * Below this, a hidden strip is browser chrome or rounding rather than a
 * keyboard — no virtual keyboard is 80px tall, and lifting by a few pixels
 * would only jitter. The deliberate trade-off: an external keyboard's ~45px
 * accessory bar (iPad in a narrow split view) reads as "no keyboard" and is not
 * cleared, in exchange for never parking the sheet above a phantom inset that a
 * bottom toolbar happened to produce.
 */
export const KEYBOARD_MIN_INSET_PX = 80

/** Pinch-zoom also shrinks `visualViewport.height`; only ~1 is a keyboard. */
const MAX_KEYBOARD_SCALE = 1.05

/**
 * Resolve one viewport reading into "pixels of the layout viewport the keyboard
 * is covering". Returns 0 for every not-a-keyboard case, so `> 0` is a reliable
 * "the keyboard is up".
 */
export function resolveKeyboardInset(s: ViewportSample): number {
  // Pinch-zoom shrinks the visual viewport too — treat only scale ~1 as a
  // keyboard, otherwise zooming in would shove the sheet around.
  if (s.scale > MAX_KEYBOARD_SCALE) return 0

  // The dismissal escape hatch. iOS 26 does not reliably reset
  // `visualViewport.offsetTop` (and sometimes not `height`) after the keyboard
  // goes away, which leaves a phantom inset and a sheet stuck in the lifted
  // position. Focus is the more trustworthy signal: nothing focused, no
  // keyboard. `null` means we have no focus signal, and the measurement below
  // is used on its own.
  if (s.composerFocused === false) return 0

  // Nothing is covering the visual viewport, so any `offsetTop` is leftover
  // scroll rather than a keyboard. This is the same iOS 26 staleness guard
  // expressed in viewport terms only, for the paths where focus is unknown.
  if (!(s.visualHeight < s.innerHeight - 1)) return 0

  // offsetTop matters on iOS: focusing an input near the bottom makes Safari
  // scroll the visual viewport down within the layout viewport, so the hidden
  // strip is what remains below the visual viewport's bottom edge.
  const hidden = s.innerHeight - s.visualHeight - s.offsetTop
  if (!Number.isFinite(hidden) || hidden < KEYBOARD_MIN_INSET_PX) return 0
  return Math.round(Math.min(hidden, s.innerHeight))
}

/**
 * How long the consumer's CSS transition runs. Kept here only to time the
 * `settling` flag (which exists so `will-change` can be dropped again); the
 * authoritative duration is the CSS one in AiDock.vue — keep them in step.
 */
export const LIFT_MS = 250

/**
 * Quiet period that ends a burst of `visualViewport` events. Short enough that
 * a trailing correction lands inside the lift animation, long enough that a
 * burst resolves to a single target. Note this never delays the *start* of the
 * motion: a change of open/closed state is committed on the first event.
 */
const SETTLE_MS = 140

function isTextEntry(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName === "TEXTAREA") return true
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type
    return !["button", "checkbox", "radio", "range", "reset", "submit", "file", "color"].includes(
      type,
    )
  }
  return el instanceof HTMLElement && el.isContentEditable
}

export function useKeyboardInset() {
  /** Pixels of the layout viewport hidden behind the keyboard, once settled. */
  const inset = ref(0)
  /** Usable height in CSS pixels (the visual viewport), once settled. */
  const viewportHeight = ref(0)
  /**
   * True from a committed change until the consumer's transition should have
   * finished. Consumers use it to add `will-change` for the duration of the
   * motion only, rather than parking a compositor hint on the sheet forever.
   */
  const settling = ref(false)

  let composerFocused: boolean | null = null
  let trailingTimer: ReturnType<typeof setTimeout> | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  function read(): ViewportSample | null {
    const vv = window.visualViewport
    if (!vv) return null
    return {
      innerHeight: window.innerHeight,
      visualHeight: vv.height,
      offsetTop: vv.offsetTop,
      scale: vv.scale,
      composerFocused,
    }
  }

  function commit(next: number, usable: number) {
    const moved = Math.abs(next - inset.value) > 1 || Math.abs(usable - viewportHeight.value) > 1
    inset.value = next
    viewportHeight.value = usable
    if (!moved) return

    settling.value = true
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settling.value = false
      settleTimer = null
    }, LIFT_MS + 60)
  }

  function clearTrailing() {
    if (trailingTimer) clearTimeout(trailingTimer)
    trailingTimer = null
  }

  /** Re-read once the event burst has gone quiet and commit the final target. */
  function scheduleTrailing() {
    clearTrailing()
    trailingTimer = setTimeout(() => {
      trailingTimer = null
      const s = read()
      if (!s) return
      commit(resolveKeyboardInset(s), s.visualHeight)
    }, SETTLE_MS)
  }

  function measure() {
    const s = read()
    if (!s) return
    const next = resolveKeyboardInset(s)

    const isOpen = next > 0
    const wasOpen = inset.value > 0

    if (isOpen !== wasOpen) {
      // The keyboard opened or closed. Commit now so the lift starts at once —
      // a debounce here is what would make opening feel laggy.
      clearTrailing()
      commit(next, s.visualHeight)
      // Opening: this first reading is usually a partial keyboard height, so
      // let the burst settle and re-target. Closing: the resting target is
      // exactly 0 and cannot be refined, so the animation runs once, cleanly.
      if (isOpen) scheduleTrailing()
      return
    }

    // Same state, only the numbers moving (keyboard still animating, accessory
    // bar appearing, orientation change). Publish one settled value, not the
    // dozen intermediate ones iOS happens to emit.
    scheduleTrailing()
  }

  function onFocusIn(event: FocusEvent) {
    if (blurTimer) {
      clearTimeout(blurTimer)
      blurTimer = null
    }
    composerFocused = isTextEntry(event.target as Element | null)
    measure()
  }

  function onFocusOut() {
    // `relatedTarget` is unreliable on iOS, so settle the question on the next
    // task, once focus has actually moved.
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = setTimeout(() => {
      blurTimer = null
      composerFocused = isTextEntry(document.activeElement)
      measure()
    }, 0)
  }

  onMounted(() => {
    if (!import.meta.client || !window.visualViewport) return
    composerFocused = isTextEntry(document.activeElement)
    const first = read()
    if (first) commit(resolveKeyboardInset(first), first.visualHeight)

    window.visualViewport.addEventListener("resize", measure)
    window.visualViewport.addEventListener("scroll", measure)
    window.addEventListener("resize", measure)
    window.addEventListener("orientationchange", measure)
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    window.visualViewport?.removeEventListener("resize", measure)
    window.visualViewport?.removeEventListener("scroll", measure)
    window.removeEventListener("resize", measure)
    window.removeEventListener("orientationchange", measure)
    document.removeEventListener("focusin", onFocusIn)
    document.removeEventListener("focusout", onFocusOut)
    clearTrailing()
    if (settleTimer) clearTimeout(settleTimer)
    if (blurTimer) clearTimeout(blurTimer)
  })

  return { inset, viewportHeight, settling }
}
