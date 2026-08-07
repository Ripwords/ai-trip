/**
 * The traveler's thinking-mode preference.
 *
 * sessionStorage, not localStorage: thinking mode costs 3x credits, and a
 * preference that survives browser restarts is a preference people forget is
 * on. Clearing it with the tab is the intended safety valve.
 *
 * The read/write helpers take the Storage explicitly so they are unit-testable
 * without a DOM, and so SSR (where there is no sessionStorage) is a plain null.
 */
export const THINKING_MODE_KEY = "ai-trip.thinking-mode"

export function readThinkingMode(store: Storage | null): boolean {
  if (!store) return false
  try {
    return store.getItem(THINKING_MODE_KEY) === "true"
  } catch {
    // Private-mode / blocked storage. Off is the safe answer: it never spends
    // credits the traveler did not ask to spend.
    return false
  }
}

export function writeThinkingMode(store: Storage | null, value: boolean): void {
  if (!store) return
  try {
    store.setItem(THINKING_MODE_KEY, String(value))
  } catch {
    // Preference simply does not persist this session. Not worth surfacing.
  }
}

export function useThinkingMode() {
  const enabled = useState("thinking-mode", () => false)

  // Hydrate on the client only — sessionStorage does not exist during SSR, and
  // reading it in setup would make the server and client render disagree.
  onMounted(() => {
    enabled.value = readThinkingMode(import.meta.client ? window.sessionStorage : null)
  })

  function toggle() {
    enabled.value = !enabled.value
    writeThinkingMode(import.meta.client ? window.sessionStorage : null, enabled.value)
  }

  return { enabled, toggle }
}
