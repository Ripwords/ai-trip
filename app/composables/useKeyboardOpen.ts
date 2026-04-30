import { onMounted, onUnmounted, ref } from "vue"

// Detect virtual-keyboard visibility via VisualViewport API (Chrome 61+, Safari
// 13+, Firefox 90+).
//
// We listen to BOTH `resize` and `scroll`:
//   - Android Chrome fires `resize` when the keyboard pushes content up.
//   - iOS Safari does NOT fire `resize` reliably when the keyboard opens; it
//     instead offsets the visual viewport (shifting focused content into view),
//     which fires `scroll`.
//
// The newer VirtualKeyboard API gives precise geometry but only fires events
// after opting into `overlaysContent = true`, which removes the browser's
// default layout behavior — too invasive for detection alone.
const KEYBOARD_THRESHOLD_PX = 150

export function useKeyboardOpen() {
  const open = ref(false)

  function check() {
    const vv = window.visualViewport
    if (!vv) return
    open.value = window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX
  }

  onMounted(() => {
    if (!import.meta.client || !window.visualViewport) return
    check()
    window.visualViewport.addEventListener("resize", check)
    window.visualViewport.addEventListener("scroll", check)
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    window.visualViewport?.removeEventListener("resize", check)
    window.visualViewport?.removeEventListener("scroll", check)
  })

  return { open }
}
