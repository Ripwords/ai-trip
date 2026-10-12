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

  // B8: a placeId Google cannot resolve is not evidence the place exists. The
  // payload's coordinates came from the same untrusted source as the id, so
  // they must not survive a failed Place Details call.
  it("leaves an activity unresolved when its placeId 404s and search finds nothing", async () => {
    const searches: string[] = []
    const deps = {
      searchPlace: async (query: string) => {
        searches.push(query)
        return []
      },
      getPlaceDetails: async () => {
        throw new Error("404 NOT_FOUND")
      },
    }

    const result = await enrichActivity(
      { ...baseActivity, placeId: "invented-place-id", lat: 16.1075, lng: 108.2967 },
      "Đà Nẵng, Vietnam",
      undefined,
      deps,
    )

    assert.deepEqual(searches, ["Coffee at Sơn Trà Marina Đà Nẵng, Vietnam"])
    assert.equal(result.placeId, null)
    assert.equal(result.lat, null)
    assert.equal(result.lng, null)
    assert.equal(result.address, null)
  })

  it("falls back to a text search near the area when the placeId does not resolve", async () => {
    const biases: unknown[] = []
    const deps = {
      searchPlace: async (_query: string, bias?: { lat: number; lng: number }) => {
        biases.push(bias)
        return [
          {
            name: "Sơn Trà Marina",
            placeId: "real-place-id",
            lat: 16.1,
            lng: 108.29,
            formattedAddress: "Sơn Trà, Đà Nẵng",
          },
        ]
      },
      getPlaceDetails: async (placeId: string) =>
        placeId === "real-place-id"
          ? { name: "Sơn Trà Marina", placeId, lat: 16.1, lng: 108.29, rating: 4.4 }
          : null,
    }

    const result = await enrichActivity(
      { ...baseActivity, placeId: "invented-place-id", lat: 1, lng: 2, address: "Nowhere" },
      "Đà Nẵng, Vietnam",
      { lat: 16.05, lng: 108.2 },
      deps,
    )

    assert.deepEqual(biases, [{ lat: 16.05, lng: 108.2 }])
    assert.equal(result.placeId, "real-place-id")
    assert.equal(result.lat, 16.1)
    assert.equal(result.lng, 108.29)
    assert.equal(result.address, "Sơn Trà, Đà Nẵng")
    assert.equal(result.rating, 4.4)
  })

  it("takes coordinates and address from Google, never from the payload", async () => {
    const { deps } = makeDeps()

    const result = await enrichActivity(
      {
        ...baseActivity,
        placeId: "resolved-place-id",
        lat: 48.8584,
        lng: 2.2945,
        address: "Champ de Mars, Paris",
      },
      "Đà Nẵng, Vietnam",
      undefined,
      deps,
    )

    assert.equal(result.lat, 16.1075)
    assert.equal(result.lng, 108.2967)
    assert.equal(result.address, "Sơn Trà, Đà Nẵng, Vietnam")
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

describe("resolvePlace", () => {
  it("returns null when neither the placeId nor a search resolves", async () => {
    const { resolvePlace } = await import("./enrich")
    const result = await resolvePlace(
      { name: "Imaginary Hotel", placeId: "fake" },
      { destination: "Tokyo" },
      { searchPlace: async () => [], getPlaceDetails: async () => null },
    )
    assert.equal(result, null)
  })

  it("searches by name when no placeId is given", async () => {
    const { resolvePlace } = await import("./enrich")
    const result = await resolvePlace(
      { name: "Park Hyatt" },
      { destination: "Tokyo" },
      {
        searchPlace: async () => [
          { name: "Park Hyatt Tokyo", placeId: "ph", lat: 35.68, lng: 139.69 },
        ],
        getPlaceDetails: async () => null,
      },
    )
    assert.deepEqual(result, {
      name: "Park Hyatt Tokyo",
      placeId: "ph",
      lat: 35.68,
      lng: 139.69,
      address: null,
      rating: null,
      openingHours: [],
      priceLevel: null,
    })
  })

  it("treats a search outage as unresolved rather than throwing", async () => {
    const { resolvePlace } = await import("./enrich")
    const result = await resolvePlace(
      { name: "Park Hyatt" },
      { destination: "Tokyo" },
      {
        searchPlace: async () => {
          throw new Error("places down")
        },
        getPlaceDetails: async () => null,
      },
    )
    assert.equal(result, null)
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

describe("partitionGeocoded", () => {
  it("separates activities with coordinates from those without", async () => {
    const { partitionGeocoded } = await import("./enrich")
    const { located, unlocated } = partitionGeocoded([
      { name: "Marble Mountains", lat: 16.0, lng: 108.2 },
      { name: "Coffee at Sơn Trà Marina", lat: null, lng: null },
      { name: "Han Market", lat: 16.06, lng: null },
    ])
    assert.deepEqual(
      located.map((a) => a.name),
      ["Marble Mountains"],
    )
    assert.deepEqual(
      unlocated.map((a) => a.name),
      ["Coffee at Sơn Trà Marina", "Han Market"],
    )
  })
})
