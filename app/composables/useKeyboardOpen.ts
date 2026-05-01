import { onMounted, onUnmounted, ref } from "vue"

// Detect virtual-keyboard visibility. Two signals, because the meta
// `interactive-widget` value changes which one fires:
//
// - `resizes-visual` (legacy default): keyboard shrinks visualViewport but the
//   layout viewport / window.innerHeight stay full. Detect via
//   `innerHeight - vv.height - vv.offsetTop`. The offsetTop subtraction matters
//   on iOS Safari, which auto-scrolls the document when an input near the
//   bottom is focused.
//
// - `resizes-content` (this app's setting): keyboard shrinks the layout
//   viewport itself, so innerHeight drops AND vv.height matches innerHeight —
//   the `innerHeight - vv.height` signal is always 0. Detect instead by
//   tracking the largest innerHeight ever seen and watching for drops.
//
// We compute both and OR them together so this works regardless of the meta
// value or browser support.
const KEYBOARD_THRESHOLD_PX = 150

export function useKeyboardOpen() {
  const open = ref(false)
  let baselineHeight = 0

  function check() {
    const vv = window.visualViewport
    if (!vv) return
    // visualViewport.scroll also fires during pinch-zoom panning, and zooming
    // shrinks vv.height. Gate on scale≈1 so pinch-zoom isn't mistaken for the
    // keyboard opening.
    if (vv.scale > 1.05) {
      open.value = false
      return
    }

    if (window.innerHeight > baselineHeight) baselineHeight = window.innerHeight
    const layoutShrink = baselineHeight - window.innerHeight
    const visualShrink = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)

    open.value = layoutShrink > KEYBOARD_THRESHOLD_PX || visualShrink > KEYBOARD_THRESHOLD_PX
  }

  onMounted(() => {
    if (!import.meta.client || !window.visualViewport) return
    baselineHeight = window.innerHeight
    check()
    window.visualViewport.addEventListener("resize", check)
    window.visualViewport.addEventListener("scroll", check)
    window.addEventListener("resize", check)
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    window.visualViewport?.removeEventListener("resize", check)
    window.visualViewport?.removeEventListener("scroll", check)
    window.removeEventListener("resize", check)
  })

  return { open }
}
