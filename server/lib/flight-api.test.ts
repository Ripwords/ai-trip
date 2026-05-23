import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { lookupFlight, FLIGHT_LOOKUP_SCHEMA_VERSION } from "./flight-api"
import { clearRateLimitState, makeMemoryStore } from "./flight-api-cache"

const originalKey = process.env.AERODATABOX_API_KEY

beforeEach(() => {
  process.env.AERODATABOX_API_KEY = "test-key"
  clearRateLimitState()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.AERODATABOX_API_KEY
  else process.env.AERODATABOX_API_KEY = originalKey
})

const FUTURE_DATE = "2099-05-26"

const SAMPLE_RESPONSE = [
  {
    airline: { name: "EVA Air" },
    flight: { number: "BR228", iataNumber: "BR228" },
    departure: {
      airport: { iata: "KUL", name: "Kuala Lumpur Intl" },
      scheduledTime: { utc: "2099-05-26T12:25Z", local: "2099-05-26 20:25+08:00" },
      terminal: "1",
      gate: "C34",
    },
    arrival: {
      airport: { iata: "TPE", name: "Taipei Taoyuan" },
      scheduledTime: { utc: "2099-05-26T16:25Z", local: "2099-05-27 00:25+08:00" },
    },
    status: "scheduled",
  },
]

interface FetchCall {
  url: string
}

function makeFetch(responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  const calls: FetchCall[] = []
  let i = 0
  const impl = (async (url: string) => {
    calls.push({ url })
    const r = responses[i++] ?? responses[responses.length - 1]!
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`) as Error & { statusCode?: number }
      err.statusCode = r.status
      throw err
    }
    return r.body
  }) as unknown as typeof $fetch
  return { impl, calls }
}

describe("lookupFlight cache integration", () => {
  it("fetches once, then serves from cache for repeat callers within TTL", async () => {
    const store = makeMemoryStore()
    const { impl, calls } = makeFetch([{ ok: true, body: SAMPLE_RESPONSE }])
    const now = () => new Date("2099-05-26T11:00:00Z")

    const a = await lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now })
    const b = await lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now })

    expect(calls).toHaveLength(1)
    expect(a?.airline).toBe("EVA Air")
    expect(b?.airline).toBe("EVA Air")
  })

  it("coalesces concurrent requests for the same key into one API call", async () => {
    const store = makeMemoryStore()
    const { impl, calls } = makeFetch([{ ok: true, body: SAMPLE_RESPONSE }])
    const now = () => new Date("2099-05-26T11:00:00Z")

    const results = await Promise.all([
      lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now }),
      lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now }),
      lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now }),
    ])

    expect(calls).toHaveLength(1)
    expect(results.every((r) => r?.airline === "EVA Air")).toBe(true)
  })

  it("caches 404 responses so repeat lookups don't hit the API again", async () => {
    const store = makeMemoryStore()
    const { impl, calls } = makeFetch([{ ok: false, status: 404 }])
    const now = () => new Date("2099-05-26T11:00:00Z")

    const a = await lookupFlight("BR000", FUTURE_DATE, { store, fetchImpl: impl, now })
    const b = await lookupFlight("BR000", FUTURE_DATE, { store, fetchImpl: impl, now })

    expect(calls).toHaveLength(1)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it("on 429, suppresses subsequent calls for the cooldown window", async () => {
    const store = makeMemoryStore()
    const { impl, calls } = makeFetch([
      { ok: false, status: 429 },
      { ok: true, body: SAMPLE_RESPONSE },
    ])
    const now = () => new Date("2099-05-26T11:00:00Z")

    const first = await lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now })
    expect(first).toBeNull()
    expect(calls).toHaveLength(1)

    // Different flight, same cooldown window — must not hit the API.
    const second = await lookupFlight("BR999", FUTURE_DATE, { store, fetchImpl: impl, now })
    expect(second).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("on 429, serves stale cached data when present rather than null", async () => {
    const store = makeMemoryStore()
    const past = new Date("2099-05-26T08:00:00Z")
    // Seed a cache entry that's older than the active-window TTL (5 min).
    await store.set("BR228", FUTURE_DATE, {
      response: SAMPLE_RESPONSE[0] as Record<string, unknown>,
      notFound: false,
      fetchedAt: past,
      lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
    })
    const { impl, calls } = makeFetch([{ ok: false, status: 429 }])
    const now = () => new Date("2099-05-26T11:00:00Z")

    const first = await lookupFlight("BR228", FUTURE_DATE, { store, fetchImpl: impl, now })
    // First call: cache is stale, falls through to API, gets 429, returns stale data.
    expect(first?.airline).toBe("EVA Air")
    expect(calls).toHaveLength(1)
  })

  it("bypassCache forces a refetch even when cache is fresh", async () => {
    const store = makeMemoryStore()
    await store.set("BR228", FUTURE_DATE, {
      response: SAMPLE_RESPONSE[0] as Record<string, unknown>,
      notFound: false,
      fetchedAt: new Date("2099-05-26T10:58:00Z"),
      lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
    })
    const updated = [
      { ...SAMPLE_RESPONSE[0]!, departure: { ...SAMPLE_RESPONSE[0]!.departure, gate: "C99" } },
    ]
    const { impl, calls } = makeFetch([{ ok: true, body: updated }])
    const now = () => new Date("2099-05-26T11:00:00Z")

    const result = await lookupFlight("BR228", FUTURE_DATE, {
      store,
      fetchImpl: impl,
      now,
      bypassCache: true,
    })

    expect(calls).toHaveLength(1)
    expect(result?.gate).toBe("C99")
  })
})
