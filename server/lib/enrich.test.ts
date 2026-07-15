import assert from "node:assert/strict"
import { describe, it } from "node:test"

// google-maps.ts registers cached fns via the Nitro auto-import
// `defineCachedFunction` at module-eval time, which isn't present in a raw
// node:test process. Shim it before importing enrich so the module loads;
// the real maps fns are never invoked — tests inject fakes via deps.
;(globalThis as { defineCachedFunction?: unknown }).defineCachedFunction = (fn: unknown) => fn

const { enrichActivity, enrichItinerary } = await import("./enrich")

const baseActivity = {
  name: "Coffee at Sơn Trà Marina",
  type: "cafe" as const,
  description: "Coffee with an ocean view",
  suggestedTime: "13:00",
  estimatedDurationMinutes: 90,
  costEstimate: 5,
  tags: ["coffee"],
}

function makeDeps() {
  const calls = { search: 0, details: [] as string[] }
  return {
    calls,
    deps: {
      searchPlace: async () => {
        calls.search++
        return []
      },
      getPlaceDetails: async (placeId: string) => {
        calls.details.push(placeId)
        return {
          name: "Sơn Trà Marina",
          placeId,
          lat: 16.1075,
          lng: 108.2967,
          rating: 4.3,
          formattedAddress: "Sơn Trà, Đà Nẵng, Vietnam",
          openingHours: ["Monday: 8:00 AM – 10:00 PM"],
          priceLevel: 2,
        }
      },
    },
  }
}

describe("enrichActivity", () => {
  it("reuses an agent-resolved placeId instead of re-searching Google Places", async () => {
    const { calls, deps } = makeDeps()

    // The discuss agent already resolved this venue via searchPlaces and put
    // the placeId + coords on the proposal payload. Enrichment must NOT throw
    // that away and re-search the descriptive display name biased to the
    // (far-away) accommodation address — that's exactly what dropped the
    // "Coffee at Sơn Trà Marina" activity.
    const result = await enrichActivity(
      { ...baseActivity, placeId: "resolved-place-id", lat: 16.1075, lng: 108.2967 },
      "Four Seasons Resort The Nam Hai, Điện Bàn, Đà Nẵng, Vietnam",
      { lat: 15.95, lng: 108.29 },
      deps,
    )

    assert.equal(calls.search, 0, "must not re-search a place that is already resolved")
    assert.deepEqual(calls.details, ["resolved-place-id"])
    assert.equal(result.placeId, "resolved-place-id")
    assert.equal(result.lat, 16.1075)
    assert.equal(result.lng, 108.2967)
    assert.equal(result.rating, 4.3)
  })

  it("keeps the resolved place even when Place Details lookup fails", async () => {
    const { calls } = makeDeps()
    const deps = {
      searchPlace: async () => {
        calls.search++
        return []
      },
      getPlaceDetails: async () => null,
    }

    const result = await enrichActivity(
      { ...baseActivity, placeId: "resolved-place-id", lat: 16.1075, lng: 108.2967 },
      "Four Seasons Resort The Nam Hai, Điện Bàn, Đà Nẵng, Vietnam",
      undefined,
      deps,
    )

    assert.equal(calls.search, 0, "must not fall back to search when a placeId is present")
    assert.equal(result.placeId, "resolved-place-id")
    assert.equal(result.lat, 16.1075)
    assert.equal(result.lng, 108.2967)
  })

  it("falls back to a text search when no placeId was resolved", async () => {
    const calls = { search: 0 }
    const deps = {
      searchPlace: async () => {
        calls.search++
        return [
          {
            name: "Some Cafe",
            placeId: "searched-place-id",
            lat: 16.0,
            lng: 108.2,
            formattedAddress: "Đà Nẵng",
          },
        ]
      },
      getPlaceDetails: async () => null,
    }

    const result = await enrichActivity(baseActivity, "Đà Nẵng, Vietnam", undefined, deps)

    assert.equal(calls.search, 1)
    assert.equal(result.placeId, "searched-place-id")
    assert.equal(result.lat, 16.0)
  })
})

describe("enrichItinerary", () => {
  it("does not count a pre-resolved activity as an enrichment failure", async () => {
    const { deps } = makeDeps()

    const enriched = await enrichItinerary(
      {
        days: [
          {
            dayNumber: 0,
            theme: "",
            activities: [
              { ...baseActivity, placeId: "resolved-place-id", lat: 16.1075, lng: 108.2967 },
            ],
          },
        ],
      },
      "Four Seasons Resort The Nam Hai, Điện Bàn, Đà Nẵng, Vietnam",
      { lat: 15.95, lng: 108.29 },
      deps,
    )

    assert.equal(enriched.enrichmentFailures, 0)
    assert.equal(enriched.days[0]?.activities[0]?.lat, 16.1075)
  })
})
