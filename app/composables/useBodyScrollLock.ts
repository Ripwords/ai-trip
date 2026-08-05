import type { MaybeRefOrGetter } from "vue"

// Nested modals/sheets can be open at once (a bottom sheet over a page that
// already opened one). Refcount so the inner one closing does not release the
// lock the outer one still needs.
let lockCount = 0
let restore: (() => void) | null = null

function acquire() {
  if (!import.meta.client) return
  lockCount++
  if (lockCount > 1) return

  const { body, documentElement } = document
  const scrollY = window.scrollY
  const prev = {
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
    overflow: body.style.overflow,
    scrollBehavior: documentElement.style.scrollBehavior,
  }

  // `overflow: hidden` alone does not stop iOS Safari from rubber-banding the
  // page behind a fixed overlay. Pinning the body and offsetting by the current
  // scroll position does, and keeps the visual position identical.
  documentElement.style.scrollBehavior = "auto"
  body.style.position = "fixed"
  body.style.top = `-${scrollY}px`
  body.style.width = "100%"
  body.style.overflow = "hidden"

  restore = () => {
    body.style.position = prev.position
    body.style.top = prev.top
    body.style.width = prev.width
    body.style.overflow = prev.overflow
    window.scrollTo(0, scrollY)
    documentElement.style.scrollBehavior = prev.scrollBehavior
  }
}

function release() {
  if (!import.meta.client) return
  if (lockCount === 0) return
  lockCount--
  if (lockCount === 0) {
    restore?.()
    restore = null
  }
}

/**
 * Freezes background page scroll while `isOpen` is true, so a fixed overlay
 * cannot be scrolled "through" and iOS cannot rubber-band the page behind it.
 * Releases automatically when the owning scope is disposed.
 */
export function useBodyScrollLock(isOpen: MaybeRefOrGetter<boolean>) {
  let held = false

  function sync(open: boolean) {
    if (open === held) return
    held = open
    if (open) acquire()
    else release()
  }

  watch(() => toValue(isOpen), sync, { immediate: true })

  onScopeDispose(() => sync(false))
}
