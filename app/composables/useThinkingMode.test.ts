import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import { readThinkingMode, writeThinkingMode, THINKING_MODE_KEY } from "./useThinkingMode"

/** Minimal in-memory Storage stand-in — the composable must not depend on a DOM. */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe("thinking mode persistence", () => {
  let store: Storage
  beforeEach(() => {
    store = fakeStorage()
  })

  it("defaults to off when nothing is stored", () => {
    // Opt-in, always. Thinking mode costs 3x; it must never be on by accident.
    assert.equal(readThinkingMode(store), false)
  })

  it("round-trips an enabled value", () => {
    writeThinkingMode(store, true)
    assert.equal(readThinkingMode(store), true)
  })

  it("round-trips a disabled value", () => {
    writeThinkingMode(store, true)
    writeThinkingMode(store, false)
    assert.equal(readThinkingMode(store), false)
  })

  it("treats a corrupt stored value as off rather than throwing", () => {
    store.setItem(THINKING_MODE_KEY, "not-a-bool")
    assert.equal(readThinkingMode(store), false)
  })

  it("survives storage being unavailable (private mode, SSR)", () => {
    const throwing: Storage = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error("denied")
      },
      setItem: () => {
        throw new Error("denied")
      },
    }
    assert.equal(readThinkingMode(throwing), false)
    assert.doesNotThrow(() => writeThinkingMode(throwing, true))
  })

  it("returns false when no storage exists at all", () => {
    assert.equal(readThinkingMode(null), false)
  })
})
