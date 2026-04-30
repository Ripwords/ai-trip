import { onMounted, onUnmounted, ref } from "vue"

const KEYBOARD_THRESHOLD = 150

export function useKeyboardOpen() {
  const open = ref(false)

  function check() {
    const vv = window.visualViewport
    if (!vv) {
      open.value = false
      return
    }
    open.value = window.innerHeight - vv.height > KEYBOARD_THRESHOLD
  }

  onMounted(() => {
    if (!import.meta.client) return
    check()
    window.visualViewport?.addEventListener("resize", check)
    window.visualViewport?.addEventListener("scroll", check)
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    window.visualViewport?.removeEventListener("resize", check)
    window.visualViewport?.removeEventListener("scroll", check)
  })

  return { open }
}
