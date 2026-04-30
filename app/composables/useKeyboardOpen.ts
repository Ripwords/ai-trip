import { onMounted, onUnmounted, ref } from "vue"

// Detect virtual-keyboard visibility via VisualViewport API (Chrome 61+, Safari
// 13+, Firefox 90+). The newer VirtualKeyboard API gives precise geometry but
// only fires events after opting into `overlaysContent = true`, which changes
// the browser's default layout behavior (keyboard would no longer push the
// viewport). We want detection only, so VisualViewport is the right fit.
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
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    window.visualViewport?.removeEventListener("resize", check)
  })

  return { open }
}
