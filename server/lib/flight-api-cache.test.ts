import { describe, it, expect, beforeEach } from "bun:test"
import {
  isCacheFresh,
  classifyFlight,
  getCachedFlight,
  setCachedFlight,
  dedupInFlight,
  isRateLimited,
  markRateLimited,
  clearRateLimitState,
  makeMemoryStore,
  type CacheEntry,
} from "./flight-api-cache"

describe("classifyFlight", () => {
  const flightDate = "2026-05-26"

  it("returns 'past' when more than 24h after flight date", () => {
    expect(classifyFlight(flightDate, new Date("2026-05-28T00:00:01Z"))).toBe("past")
  })

  it("returns 'active' when within 24h before or after flight date", () => {
    expect(classifyFlight(flightDate, new Date("2026-05-25T12:00:00Z"))).toBe("active")
    expect(classifyFlight(flightDate, new Date("2026-05-26T12:00:00Z"))).toBe("active")
    expect(classifyFlight(flightDate, new Date("2026-05-27T12:00:00Z"))).toBe("active")
  })

  it("returns 'future' when more than 24h before flight date", () => {
    expect(classifyFlight(flightDate, new Date("2026-05-24T00:00:00Z"))).toBe("future")
  })
})

describe("isCacheFresh", () => {
  const flightDate = "2026-05-26"
  function entry(fetchedAt: Date, opts: Partial<CacheEntry> = {}): CacheEntry {
    return {
      response: { foo: "bar" },
      notFound: false,
      fetchedAt,
      lookupSchemaVersion: 1,
      ...opts,
    }
  }

  it("treats past flights as fresh forever", () => {
    const fetched = new Date("2025-01-01T00:00:00Z")
    const now = new Date("2026-05-28T01:00:00Z")
    expect(isCacheFresh(entry(fetched), flightDate, 1, now)).toBe(true)
  })

  it("uses a 5-minute TTL during the active window", () => {
    const now = new Date("2026-05-26T12:00:00Z")
    expect(isCacheFresh(entry(new Date(now.getTime() - 4 * 60_000)), flightDate, 1, now)).toBe(true)
    expect(isCacheFresh(entry(new Date(now.getTime() - 6 * 60_000)), flightDate, 1, now)).toBe(
      false,
    )
  })

  it("uses a 2-hour TTL for distant future flights", () => {
    const now = new Date("2026-05-20T12:00:00Z")
    expect(isCacheFresh(entry(new Date(now.getTime() - 90 * 60_000)), flightDate, 1, now)).toBe(
      true,
    )
    expect(isCacheFresh(entry(new Date(now.getTime() - 150 * 60_000)), flightDate, 1, now)).toBe(
      false,
    )
  })

  it("treats entries with older schema versions as stale", () => {
    const now = new Date("2026-05-26T12:00:00Z")
    const e = entry(new Date(now.getTime() - 60_000), { lookupSchemaVersion: 0 })
    expect(isCacheFresh(e, flightDate, 1, now)).toBe(false)
  })

  it("uses a 24h TTL for negative-cached entries", () => {
    const now = new Date("2026-05-26T12:00:00Z")
    const fresh: CacheEntry = {
      response: null,
      notFound: true,
      fetchedAt: new Date(now.getTime() - 23 * 60 * 60_000),
      lookupSchemaVersion: 1,
    }
    const stale: CacheEntry = { ...fresh, fetchedAt: new Date(now.getTime() - 25 * 60 * 60_000) }
    expect(isCacheFresh(fresh, flightDate, 1, now)).toBe(true)
    expect(isCacheFresh(stale, flightDate, 1, now)).toBe(false)
  })
})

describe("getCachedFlight / setCachedFlight", () => {
  it("returns null when no row exists", async () => {
    const store = makeMemoryStore()
    const result = await getCachedFlight("BR228", "2026-05-26", { store })
    expect(result).toBeNull()
  })

  it("returns the cached row including notFound flag", async () => {
    const store = makeMemoryStore()
    await setCachedFlight(
      "BR228",
      "2026-05-26",
      {
        response: null,
        notFound: true,
        fetchedAt: new Date("2026-05-26T11:00:00Z"),
        lookupSchemaVersion: 1,
      },
      { store },
    )
    const result = await getCachedFlight("BR228", "2026-05-26", { store })
    expect(result?.notFound).toBe(true)
    expect(result?.response).toBeNull()
  })

  it("setCachedFlight upserts (later write wins)", async () => {
    const store = makeMemoryStore()
    await setCachedFlight(
      "BR228",
      "2026-05-26",
      {
        response: { airline: "EVA Air" },
        notFound: false,
        fetchedAt: new Date("2026-05-26T11:00:00Z"),
        lookupSchemaVersion: 1,
      },
      { store },
    )
    await setCachedFlight(
      "BR228",
      "2026-05-26",
      {
        response: { airline: "EVA Air", terminal: "2" },
        notFound: false,
        fetchedAt: new Date("2026-05-26T12:00:00Z"),
        lookupSchemaVersion: 1,
      },
      { store },
    )
    const result = await getCachedFlight("BR228", "2026-05-26", { store })
    expect(result?.response).toEqual({ airline: "EVA Air", terminal: "2" })
  })
})

describe("dedupInFlight", () => {
  it("coalesces concurrent calls for the same key into one execution", async () => {
    let calls = 0
    const factory = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return { foo: "bar" } as unknown
    }
    const [a, b, c] = await Promise.all([
      dedupInFlight("k1", factory),
      dedupInFlight("k1", factory),
      dedupInFlight("k1", factory),
    ])
    expect(calls).toBe(1)
    expect(a).toEqual({ foo: "bar" })
    expect(b).toEqual({ foo: "bar" })
    expect(c).toEqual({ foo: "bar" })
  })

  it("fires separate calls for different keys", async () => {
    let calls = 0
    const factory = async () => {
      calls++
      return calls
    }
    await Promise.all([dedupInFlight("k2", factory), dedupInFlight("k3", factory)])
    expect(calls).toBe(2)
  })

  it("releases the slot after the promise settles (success)", async () => {
    let calls = 0
    const factory = async () => {
      calls++
      return calls
    }
    await dedupInFlight("k4", factory)
    await dedupInFlight("k4", factory)
    expect(calls).toBe(2)
  })

  it("releases the slot after the promise settles (failure)", async () => {
    let calls = 0
    const factory = async () => {
      calls++
      throw new Error("boom")
    }
    await expect(dedupInFlight("k5", factory)).rejects.toThrow("boom")
    await expect(dedupInFlight("k5", factory)).rejects.toThrow("boom")
    expect(calls).toBe(2)
  })
})

describe("rate limit cooldown", () => {
  beforeEach(() => clearRateLimitState())

  it("returns false when no rate limit has been marked", () => {
    expect(isRateLimited(new Date("2026-05-26T12:00:00Z"))).toBe(false)
  })

  it("returns true within the cooldown window after markRateLimited", () => {
    const now = new Date("2026-05-26T12:00:00Z")
    markRateLimited(now)
    expect(isRateLimited(now)).toBe(true)
    expect(isRateLimited(new Date(now.getTime() + 30_000))).toBe(true)
  })

  it("returns false after the cooldown window expires", () => {
    const now = new Date("2026-05-26T12:00:00Z")
    markRateLimited(now)
    expect(isRateLimited(new Date(now.getTime() + 61_000))).toBe(false)
  })
})
