import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { consecutiveTravelTimes, type MatrixFetcher } from "./travel-times"

function fakeFetcher(secondsByPair: Record<string, number>): {
  fetch: MatrixFetcher
  calls: { origins: number; destinations: number }[]
} {
  const calls: { origins: number; destinations: number }[] = []
  const fetch: MatrixFetcher = async (origins, destinations) => {
    calls.push({ origins: origins.length, destinations: destinations.length })
    const o = origins[0]!
    const d = destinations[0]!
    const key = `${o.lat},${o.lng}->${d.lat},${d.lng}`
    const s = secondsByPair[key]
    return [[s == null ? {} : { duration: { value: s, text: "" } }]] as never
  }
  return { fetch, calls }
}

const acts = [
  { id: "a", lat: 0, lng: 0 },
  { id: "b", lat: 1, lng: 1 },
  { id: "c", lat: 2, lng: 2 },
]

describe("consecutiveTravelTimes", () => {
  it("issues one 1x1 request per consecutive pair (never an N×N matrix)", async () => {
    const f = fakeFetcher({ "0,0->1,1": 600, "1,1->2,2": 1200 })
    const out = await consecutiveTravelTimes(acts, f.fetch)
    assert.equal(f.calls.length, 2) // N-1 pairs, not (N-1)^2
    assert.ok(f.calls.every((c) => c.origins === 1 && c.destinations === 1))
    assert.deepEqual(out, [
      { fromId: "a", toId: "b", durationMinutes: 10 },
      { fromId: "b", toId: "c", durationMinutes: 20 },
    ])
  })

  it("skips pairs with no duration and never drops the rest", async () => {
    const f = fakeFetcher({ "1,1->2,2": 300 }) // first pair has no data
    const out = await consecutiveTravelTimes(acts, f.fetch)
    assert.deepEqual(out, [{ fromId: "b", toId: "c", durationMinutes: 5 }])
  })

  it("returns nothing (and makes no calls) with fewer than two geo activities", async () => {
    const f = fakeFetcher({})
    assert.deepEqual(await consecutiveTravelTimes([{ id: "a", lat: 0, lng: 0 }], f.fetch), [])
    assert.deepEqual(
      await consecutiveTravelTimes([{ id: "a", lat: null, lng: null }, { id: "b", lat: 1, lng: 1 }], f.fetch),
      [],
    )
    assert.equal(f.calls.length, 0)
  })
})
