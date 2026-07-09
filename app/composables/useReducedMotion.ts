/**
 * Reactive `prefers-reduced-motion` flag. Use to disable JS-driven motion
 * (globe auto-rotate, camera fly-tos, scroll-reveal transforms) for users who
 * ask for reduced motion. Pure-CSS animations are already gated globally in
 * tailwind.css.
 */
export function useReducedMotion() {
  const reduced = ref(false)
  if (import.meta.client) {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reduced.value = mq.matches
    const handler = (e: MediaQueryListEvent) => {
      reduced.value = e.matches
    }
    mq.addEventListener("change", handler)
    onScopeDispose(() => mq.removeEventListener("change", handler))
  }
  return reduced
}
