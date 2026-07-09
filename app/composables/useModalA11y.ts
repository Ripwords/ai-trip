import type { MaybeRefOrGetter, Ref } from "vue"

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Adds dialog accessibility to a custom modal: focus trap, initial focus,
 * Escape-to-close, and focus restore on close.
 *
 * Pair with markup: role="dialog" aria-modal="true" aria-labelledby="<heading id>"
 * on the modal container, and bind `containerRef` to that element.
 */
export function useModalA11y(
  containerRef: Ref<HTMLElement | null>,
  opts: { isOpen: MaybeRefOrGetter<boolean>; onClose: () => void },
) {
  let previouslyFocused: HTMLElement | null = null

  function focusableNodes(): HTMLElement[] {
    const el = containerRef.value
    if (!el) return []
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    )
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation()
      opts.onClose()
      return
    }
    if (e.key !== "Tab") return
    const nodes = focusableNodes()
    if (nodes.length === 0) {
      e.preventDefault()
      return
    }
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  watch(
    () => toValue(opts.isOpen),
    async (open) => {
      if (!import.meta.client) return
      if (open) {
        previouslyFocused = document.activeElement as HTMLElement | null
        document.addEventListener("keydown", onKeydown, true)
        await nextTick()
        const nodes = focusableNodes()
        ;(nodes[0] ?? containerRef.value)?.focus()
      } else {
        document.removeEventListener("keydown", onKeydown, true)
        previouslyFocused?.focus?.()
        previouslyFocused = null
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    if (import.meta.client) document.removeEventListener("keydown", onKeydown, true)
  })
}
