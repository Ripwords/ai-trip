import { createHash } from "crypto"

import { normalizeTransportMode, type TransportMode } from "../utils/transport"

interface LatLng {
  lat: number
  lng: number
}

interface PlaceCandidate {
  name: string
  placeId: string
  lat: number
  lng: number
  rating?: number
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
  /**
   * Google-provided per-person price range (shown in Google Maps as
   * "Around $10–20"). Available for restaurants/cafes/bars; null for
   * places Google doesn't track this for (temples, transit, etc).
   */
  priceRange?: {
    startAmount: number
    endAmount: number
    currencyCode: string
  } | null
  editorialSummary?: string
}

interface DistanceMatrixEntry {
  distance: { text: string; value: number }
  duration: { text: string; value: number }
  status: string
}

function getServerMapsApiKey(): string {
  const config = useRuntimeConfig()
  return config.privateGoogleMapsApiKey || config.public.googleMapsApiKey
}

// ── Cached: Place Text Search ($35/1K — cache 24h) ──────────────────

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
            "places.displayName,places.id,places.location,places.rating,places.formattedAddress,places.types",
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
        rating: place.rating as number | undefined,
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

// ── Cached: Place Details ($5-10/1K — cache 7 days) ──────────────────

const _getPlaceDetails = defineCachedFunction(
  async (_event: unknown, placeId: string): Promise<PlaceDetails | null> => {
    const response = await $fetch<Record<string, unknown>>(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": getServerMapsApiKey(),
          "X-Goog-FieldMask":
            "displayName,id,location,rating,formattedAddress,types,photos,regularOpeningHours,priceLevel,priceRange,editorialSummary",
        },
      },
    )

    if (!response) return null

    const location = response.location as { latitude: number; longitude: number } | undefined
    const displayName = response.displayName as { text: string } | undefined
    const photos = response.photos as Array<{ name: string }> | undefined
    const openingHours = response.regularOpeningHours as
      | {
          weekdayDescriptions?: string[]
        }
      | undefined
    const editorialSummary = response.editorialSummary as { text: string } | undefined

    const priceLevelMap: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    }

    // Parse Google's priceRange (Money object: { units: string, nanos?: number, currencyCode })
    // into a flat { startAmount, endAmount, currencyCode } shape.
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
    const priceRange =
      startAmount != null && endAmount != null && currencyCode
        ? { startAmount, endAmount, currencyCode }
        : null

    return {
      name: displayName?.text ?? "",
      placeId: (response.id as string) ?? "",
      lat: location?.latitude ?? 0,
      lng: location?.longitude ?? 0,
      rating: response.rating as number | undefined,
      formattedAddress: response.formattedAddress as string | undefined,
      types: response.types as string[] | undefined,
      photos: photos?.slice(0, 3).map((p) => p.name) ?? [],
      openingHours: openingHours?.weekdayDescriptions,
      priceLevel:
        response.priceLevel != null ? (priceLevelMap[response.priceLevel as string] ?? null) : null,
      priceRange,
      editorialSummary: editorialSummary?.text,
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

// ── Cached: Place Photo ($7/1K — cache 30 days) ──────────────────────

interface CachedPhoto {
  data: string // base64
  contentType: string
}

const _getPlacePhoto = defineCachedFunction(
  async (_event: unknown, photo: string, maxWidthPx: number): Promise<CachedPhoto | null> => {
    const apiKey = getServerMapsApiKey()
    if (!apiKey) return null

    const url = new URL(`https://places.googleapis.com/v1/${photo}/media`)
    url.searchParams.set("maxWidthPx", maxWidthPx.toString())
    url.searchParams.set("skipHttpRedirect", "true")
    url.searchParams.set("key", apiKey)

    const metadataResponse = await fetch(url)
    if (!metadataResponse.ok) return null

    const metadata = (await metadataResponse.json()) as { photoUri?: string }
    if (!metadata.photoUri) return null

    const imageResponse = await fetch(metadata.photoUri)
    if (!imageResponse.ok) return null

    const buffer = Buffer.from(await imageResponse.arrayBuffer())
    return {
      data: buffer.toString("base64"),
      contentType: imageResponse.headers.get("content-type") ?? "image/jpeg",
    }
  },
  {
    maxAge: 60 * 60 * 24 * 30, // 30 days — photo content is stable
    name: "placePhoto",
    group: "maps",
    // Hash the photo reference: Google's tokens contain "/" and can exceed
    // 600 chars, which overruns the 255-byte filename limit on most filesystems.
    getKey: (_event: unknown, photo: string, maxWidthPx: number) =>
      `${createHash("sha1").update(photo).digest("hex")}__${maxWidthPx}`,
  },
)

export function getPlacePhoto(photo: string, maxWidthPx: number): Promise<CachedPhoto | null> {
  return _getPlacePhoto(null, photo, maxWidthPx)
}
