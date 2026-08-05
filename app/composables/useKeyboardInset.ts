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
 */
export function useKeyboardInset() {
  /** Pixels of the layout viewport hidden behind the keyboard. */
  const inset = ref(0)
  /** Usable height in CSS pixels (the visual viewport). */
  const viewportHeight = ref(0)

  function measure() {
    const vv = window.visualViewport
    if (!vv) return

    viewportHeight.value = vv.height

    // Pinch-zoom also shrinks visualViewport.height. Treat only scale ~1 as a
    // keyboard, otherwise zooming in would shove the sheet around.
    if (vv.scale > 1.05) {
      inset.value = 0
      return
    }

    // offsetTop matters on iOS: focusing an input near the bottom makes Safari
    // scroll the visual viewport down within the layout viewport, so the hidden
    // strip is what remains below the visual viewport's bottom edge.
    const hidden = window.innerHeight - vv.height - vv.offsetTop
    inset.value = hidden > 1 ? Math.round(hidden) : 0
  }

  onMounted(() => {
    if (!import.meta.client || !window.visualViewport) return
    measure()
    window.visualViewport.addEventListener("resize", measure)
    window.visualViewport.addEventListener("scroll", measure)
    window.addEventListener("resize", measure)
    window.addEventListener("orientationchange", measure)
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    window.visualViewport?.removeEventListener("resize", measure)
    window.visualViewport?.removeEventListener("scroll", measure)
    window.removeEventListener("resize", measure)
    window.removeEventListener("orientationchange", measure)
  })

  return { inset, viewportHeight }
}
