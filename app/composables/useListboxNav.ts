/**
 * Keyboard navigation helper for custom listbox / combobox dropdowns.
 * Manages an active (highlighted) option index and maps arrow / Home / End /
 * Enter / Escape keys to movement + selection.
 *
 * Wire the returned `onKeydown` to the trigger or search input, render options
 * with role="option" + :id, set aria-activedescendant to the active option id,
 * and give the list role="listbox".
 */
export function useListboxNav(opts: {
  itemCount: () => number
  onSelect: (index: number) => void
  onClose?: () => void
}) {
  const activeIndex = ref(-1)

  function reset() {
    activeIndex.value = -1
  }

  function clamp() {
    const n = opts.itemCount()
    if (activeIndex.value >= n) activeIndex.value = n - 1
  }

  function move(delta: number) {
    const n = opts.itemCount()
    if (n === 0) {
      activeIndex.value = -1
      return
    }
    const start = activeIndex.value < 0 ? (delta > 0 ? -1 : 0) : activeIndex.value
    activeIndex.value = (start + delta + n) % n
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        move(1)
        break
      case "ArrowUp":
        e.preventDefault()
        move(-1)
        break
      case "Home":
        e.preventDefault()
        activeIndex.value = 0
        break
      case "End":
        e.preventDefault()
        activeIndex.value = opts.itemCount() - 1
        break
      case "Enter":
        if (activeIndex.value >= 0 && activeIndex.value < opts.itemCount()) {
          e.preventDefault()
          opts.onSelect(activeIndex.value)
        }
        break
      case "Escape":
        opts.onClose?.()
        break
    }
  }

  return { activeIndex, onKeydown, reset, clamp, move }
}
