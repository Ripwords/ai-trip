import { normalizeTransportMode, type TransportMode } from "../utils/transport"

export interface LatLng {
  lat: number
  lng: number
}

interface PlaceCandidate {
  name: string
  placeId: string
  lat: number
  lng: number
  formattedAddress?: string
  types?: string[]
}

interface PlaceDetails {
  name: string
  placeId: string
  lat: number
  lng: number
  rating?: number
  formattedAddress?: string
  types?: string[]
  photos?: string[]
  openingHours?: string[]
  priceLevel?: number | null
}

/**
 * Google-provided per-person price range (shown in Google Maps as
 * "Around $10–20"). Only available for restaurants/cafes/bars.
 * Fetched separately because `priceRange` is an Atmosphere-tier field
 * that bills the whole Place Details call at the more expensive SKU.
 */
interface PlacePricing {
  priceRange: {
    startAmount: number
    endAmount: number
    currencyCode: string
  } | null
}

export interface DistanceMatrixEntry {
  distance: { text: string; value: number }
  duration: { text: string; value: number }
  status: string
}

function getServerMapsApiKey(): string {
  const config = useRuntimeConfig()
  return config.privateGoogleMapsApiKey || config.public.googleMapsApiKey
}

// ── Cached: Place Text Search — Pro SKU ($32/1K — cache 24h) ────────
//
// Field mask intentionally omits `rating` (Enterprise tier). Rating is
// hydrated later via `getPlaceDetails` once a place is actually selected,
// rather than for every type-ahead candidate. Saves ~$8/1K on every
// keystroke-driven search.

const _searchPlace = defineCachedFunction(
  async (_event: unknown, query: string, locationBiasStr?: string): Promise<PlaceCandidate[]> => {
    const body: Record<string, unknown> = { textQuery: query }

    if (locationBiasStr) {
      const parts = locationBiasStr.split(",")
      const latStr = parts[0] ?? "0"
      const lngStr = parts[1] ?? "0"
      const radiusStr = parts[2]
      body.locationBias = {
        circle: {
          center: { latitude: parseFloat(latStr), longitude: parseFloat(lngStr) },
          radius: radiusStr ? parseFloat(radiusStr) : 50000, // 50km default
        },
      }
    }

    const response = await $fetch<{ places?: Array<Record<string, unknown>> }>(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": getServerMapsApiKey(),
          "X-Goog-FieldMask":
            "places.displayName,places.id,places.location,places.formattedAddress,places.types",
        },
        body,
      },
    )

    if (!response.places) return []

    return response.places.map((place) => {
      const location = place.location as { latitude: number; longitude: number } | undefined
      const displayName = place.displayName as { text: string } | undefined

      return {
        name: displayName?.text ?? "",
        placeId: (place.id as string) ?? "",
        lat: location?.latitude ?? 0,
        lng: location?.longitude ?? 0,
        formattedAddress: place.formattedAddress as string | undefined,
        types: place.types as string[] | undefined,
      }
    })
  },
  {
    maxAge: 60 * 60 * 24, // 24 hours — place data rarely changes
    name: "searchPlace",
    group: "maps",
    getKey: (_event: unknown, query: string, locationBiasStr?: string) =>
      locationBiasStr
        ? `${query.toLowerCase().trim()}@${locationBiasStr}`
        : query.toLowerCase().trim(),
  },
)

export function searchPlace(
  query: string,
  locationBias?: { lat: number; lng: number; radius?: number },
): Promise<PlaceCandidate[]> {
  const biasStr = locationBias
    ? `${locationBias.lat.toFixed(2)},${locationBias.lng.toFixed(2)},${locationBias.radius ?? 50000}`
    : undefined
  return _searchPlace(null, query, biasStr)
}

// ── Cached: Distance Matrix ($5/1K — cache 6h) ──────────────────────

const _getDistanceMatrix = defineCachedFunction(
  async (
    _event: unknown,
    originsStr: string,
    destinationsStr: string,
    mode: TransportMode,
    departureTime: number | null,
  ): Promise<DistanceMatrixEntry[][]> => {
    const params: Record<string, string> = {
      origins: originsStr,
      destinations: destinationsStr,
      mode,
      key: getServerMapsApiKey(),
    }
    if (departureTime != null) params.departure_time = String(departureTime)

    const response = await $fetch<{
      rows: Array<{ elements: DistanceMatrixEntry[] }>
      status: string
    }>("https://maps.googleapis.com/maps/api/distancematrix/json", {
      params,
    })

    if (response.status !== "OK") {
      throw createError({
        statusCode: 502,
        message: `Distance Matrix API error: ${response.status}`,
      })
    }

    return response.rows.map((row) => row.elements)
  },
  {
    maxAge: 60 * 60 * 6, // 6 hours — travel times can vary by time of day
    name: "distanceMatrix",
    group: "maps",
    getKey: (
      _event: unknown,
      originsStr: string,
      destinationsStr: string,
      mode: TransportMode,
      departureTime: number | null,
    ) => `${mode}__${departureTime ?? "now"}__${originsStr}__${destinationsStr}`,
  },
)

export function getDistanceMatrix(
  origins: LatLng[],
  destinations: LatLng[],
  mode: TransportMode = "driving",
  departureTime?: number | null,
): Promise<DistanceMatrixEntry[][]> {
  // Round coordinates to 4 decimal places (~11m accuracy) to improve cache hits
  const originsStr = origins.map((o) => `${o.lat.toFixed(4)},${o.lng.toFixed(4)}`).join("|")
  const destinationsStr = destinations
    .map((d) => `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`)
    .join("|")
  return _getDistanceMatrix(
    null,
    originsStr,
    destinationsStr,
    normalizeTransportMode(mode),
    departureTime ?? null,
  )
}

// ── Cached: Place Details — Enterprise SKU ($25/1K — cache 7 days) ───
//
// Field mask deliberately excludes Atmosphere-tier fields (priceRange,
// editorialSummary, reviews). Adding any one of those bumps the entire
// call from Enterprise ($25/1K) to Atmosphere ($30/1K). For pricing,
// call `getPlacePricing` separately.

const _getPlaceDetails = defineCachedFunction(
  async (_event: unknown, placeId: string): Promise<PlaceDetails | null> => {
    const response = await $fetch<Record<string, unknown>>(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": getServerMapsApiKey(),
          "X-Goog-FieldMask":
            "displayName,id,location,rating,formattedAddress,types,regularOpeningHours,priceLevel",
        },
      },
    )

    if (!response) return null

    const location = response.location as { latitude: number; longitude: number } | undefined
    const displayName = response.displayName as { text: string } | undefined
    const openingHours = response.regularOpeningHours as
      | {
          weekdayDescriptions?: string[]
        }
      | undefined

    const priceLevelMap: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    }

    return {
      name: displayName?.text ?? "",
      placeId: (response.id as string) ?? "",
      lat: location?.latitude ?? 0,
      lng: location?.longitude ?? 0,
      rating: response.rating as number | undefined,
      formattedAddress: response.formattedAddress as string | undefined,
      types: response.types as string[] | undefined,
      photos: [],
      openingHours: openingHours?.weekdayDescriptions,
      priceLevel:
        response.priceLevel != null ? (priceLevelMap[response.priceLevel as string] ?? null) : null,
    }
  },
  {
    maxAge: 60 * 60 * 24 * 7, // 7 days — place details are very stable
    name: "placeDetails",
    group: "maps",
    getKey: (_event: unknown, placeId: string) => placeId,
  },
)

export function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  return _getPlaceDetails(null, placeId)
}

// ── Cached: Place Pricing — Atmosphere SKU ($30/1K — cache 7 days) ───
//
// Isolated from getPlaceDetails so only cost-derivation paths pay the
// Atmosphere premium. Returns null when Google doesn't track a price
// range for the place (temples, transit, etc).

const _getPlacePricing = defineCachedFunction(
  async (_event: unknown, placeId: string): Promise<PlacePricing | null> => {
    const response = await $fetch<Record<string, unknown>>(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": getServerMapsApiKey(),
          "X-Goog-FieldMask": "id,priceRange",
        },
      },
    )

    if (!response) return null

    const priceRangeRaw = response.priceRange as
      | {
          startPrice?: { units?: string; nanos?: number; currencyCode?: string }
          endPrice?: { units?: string; nanos?: number; currencyCode?: string }
        }
      | undefined
    const parseMoney = (m?: { units?: string; nanos?: number }): number | null => {
      if (!m) return null
      const units = m.units ? Number(m.units) : 0
      const nanos = m.nanos ?? 0
      const value = units + nanos / 1e9
      return Number.isFinite(value) ? value : null
    }
    const startAmount = parseMoney(priceRangeRaw?.startPrice)
    const endAmount = parseMoney(priceRangeRaw?.endPrice)
    const currencyCode =
      priceRangeRaw?.endPrice?.currencyCode ?? priceRangeRaw?.startPrice?.currencyCode ?? null

    return {
      priceRange:
        startAmount != null && endAmount != null && currencyCode
          ? { startAmount, endAmount, currencyCode }
          : null,
    }
  },
  {
    maxAge: 60 * 60 * 24 * 7,
    name: "placePricing",
    group: "maps",
    getKey: (_event: unknown, placeId: string) => placeId,
  },
)

export function getPlacePricing(placeId: string): Promise<PlacePricing | null> {
  return _getPlacePricing(null, placeId)
}

// ── Cached: Time Zone ($5/1K — cache 30 days) ───────────────────────
//
// Returns the IANA timeZoneId for a lat/lng (e.g. "America/New_York"). The
// zone ID is the part that matters for transit departure_time math: once we
// have it, Intl.DateTimeFormat computes the correct UTC offset for any date
// (DST-aware). Cached for 30 days because zone boundaries are stable.

const _getTimezone = defineCachedFunction(
  async (_event: unknown, locationStr: string): Promise<string | null> => {
    const apiKey = getServerMapsApiKey()
    if (!apiKey) return null

    // Google requires a timestamp param, but we only consume timeZoneId.
    // Any present-day timestamp works.
    const response = await $fetch<{
      status: string
      timeZoneId?: string
    }>("https://maps.googleapis.com/maps/api/timezone/json", {
      params: {
        location: locationStr,
        timestamp: String(Math.floor(Date.now() / 1000)),
        key: apiKey,
      },
    })

    if (response.status !== "OK" || !response.timeZoneId) return null
    return response.timeZoneId
  },
  {
    maxAge: 60 * 60 * 24 * 30, // 30 days — IANA zones are stable
    name: "timezone",
    group: "maps",
    getKey: (_event: unknown, locationStr: string) => locationStr,
  },
)

export function getTimezone(lat: number, lng: number): Promise<string | null> {
  // Round to 2 decimal places (~1km) — same timezone for any nearby point.
  const locationStr = `${lat.toFixed(2)},${lng.toFixed(2)}`
  return _getTimezone(null, locationStr)
}

// ── Cached: Geocode ($5/1K — cache 30 days) ──────────────────────────

const _geocode = defineCachedFunction(
  async (
    _event: unknown,
    address: string,
  ): Promise<{ lat: number; lng: number; formattedAddress: string } | null> => {
    const response = await $fetch<{
      results: Array<{
        geometry: { location: { lat: number; lng: number } }
        formatted_address: string
      }>
      status: string
    }>("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        address,
        key: getServerMapsApiKey(),
      },
    })

    if (response.status !== "OK" || response.results.length === 0) {
      return null
    }

    const result = response.results[0]!
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    }
  },
  {
    maxAge: 60 * 60 * 24 * 30, // 30 days — addresses don't move
    name: "geocode",
    group: "maps",
    getKey: (_event: unknown, address: string) => address.toLowerCase().trim(),
  },
)

export function geocode(
  address: string,
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  return _geocode(null, address)
}

// Place Photo (New) — Atmosphere SKU ($7/1K) — temporarily disabled.
// The image rendering paths in the UI have been stripped to eliminate
// this line item entirely. Restore by re-introducing a getPlacePhoto
// fetcher here and wiring it back into the photo endpoint handlers.
