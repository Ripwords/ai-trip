import {
  dedupInFlight,
  getCachedFlight,
  isCacheFresh,
  isRateLimited,
  markRateLimited,
  setCachedFlight,
  type CacheStore,
} from "./flight-api-cache"

const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com"

/**
 * Bumped whenever lookupFlight()'s query semantics change in a way that may yield a
 * different response for the same (flightNumber, flightDate). The flights.get endpoint
 * opportunistically re-fetches any row with a lower version.
 *
 * Version history:
 *   1 — added ?dateLocalRole=Departure to disambiguate flights crossing midnight UTC.
 */
export const FLIGHT_LOOKUP_SCHEMA_VERSION = 1

interface AeroDataBoxAirport {
  iata?: string
  icao?: string
  name?: string
  shortName?: string
  municipalityName?: string
  location?: { lat?: number; lon?: number }
  timeZone?: string
}

interface AeroDataBoxLeg {
  airport?: AeroDataBoxAirport
  scheduledTime?: { local?: string; utc?: string }
  terminal?: string
  gate?: string
}

export interface AeroDataBoxFlight {
  airline?: { name?: string }
  flight?: { number?: string; iataNumber?: string }
  departure?: AeroDataBoxLeg
  arrival?: AeroDataBoxLeg
  status?: string
}

export interface DerivedFlightFields {
  departureDate: string | null
  arrivalDate: string | null
  departureAirportLat: number | null
  departureAirportLng: number | null
  arrivalAirportLat: number | null
  arrivalAirportLng: number | null
  departureAirportName: string | null
  arrivalAirportName: string | null
}

/**
 * Pull local-time dates and airport coordinates from a stored AeroDataBox response.
 * Returns nulls for anything missing — older rows or rows where the API was unavailable
 * during creation simply won't have these fields populated.
 */
export function deriveFlightFields(raw: unknown): DerivedFlightFields {
  const flight = raw as AeroDataBoxFlight | null
  const dep = flight?.departure
  const arr = flight?.arrival
  return {
    departureDate: dep?.scheduledTime?.local?.slice(0, 10) ?? null,
    arrivalDate: arr?.scheduledTime?.local?.slice(0, 10) ?? null,
    departureAirportLat: dep?.airport?.location?.lat ?? null,
    departureAirportLng: dep?.airport?.location?.lon ?? null,
    arrivalAirportLat: arr?.airport?.location?.lat ?? null,
    arrivalAirportLng: arr?.airport?.location?.lon ?? null,
    departureAirportName: dep?.airport?.name ?? dep?.airport?.shortName ?? null,
    arrivalAirportName: arr?.airport?.name ?? arr?.airport?.shortName ?? null,
  }
}

export interface FlightLookupResult {
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: Date | null
  arrivalTime: Date | null
  terminal: string | null
  gate: string | null
  status: string
  rawApiResponse: Record<string, unknown>
}

function parseFlightResponse(flight: AeroDataBoxFlight): FlightLookupResult {
  return {
    airline: flight.airline?.name ?? null,
    departureAirport: flight.departure?.airport?.iata ?? null,
    arrivalAirport: flight.arrival?.airport?.iata ?? null,
    departureTime: flight.departure?.scheduledTime?.utc
      ? new Date(flight.departure.scheduledTime.utc)
      : null,
    arrivalTime: flight.arrival?.scheduledTime?.utc
      ? new Date(flight.arrival.scheduledTime.utc)
      : null,
    terminal: flight.departure?.terminal ?? null,
    gate: flight.departure?.gate ?? null,
    status: flight.status ?? "scheduled",
    rawApiResponse: flight as unknown as Record<string, unknown>,
  }
}

export interface LookupOptions {
  /** Override the cache store (test injection or memory-only mode). */
  store?: CacheStore
  /** Override the HTTP fetcher (test injection). Defaults to Nitro's $fetch. */
  fetchImpl?: typeof $fetch
  /** Override the clock — defaults to new Date(). */
  now?: () => Date
  /** Skip the cache and always hit the API. Result still writes through. */
  bypassCache?: boolean
}

/**
 * Look up a flight by number and date from AeroDataBox.
 *
 * Returns null when the flight is unknown, the API key is unset, or the API
 * is unavailable. See ./flight-api-cache.ts for the caching strategy.
 */
export async function lookupFlight(
  flightNumber: string,
  flightDate: string,
  opts: LookupOptions = {},
): Promise<FlightLookupResult | null> {
  const now = opts.now ?? (() => new Date())
  const cacheKey = `${flightNumber}|${flightDate}`

  // Cache I/O is fail-soft: a flight_api_cache outage degrades to "cache miss"
  // rather than breaking lookups. The API still answers; we just don't dedupe.
  const safeGetCache = async () => {
    try {
      return await getCachedFlight(flightNumber, flightDate, { store: opts.store })
    } catch (err) {
      console.warn("flight_api_cache read failed:", err)
      return null
    }
  }
  const safeSetCache = async (entry: Parameters<typeof setCachedFlight>[2]) => {
    try {
      await setCachedFlight(flightNumber, flightDate, entry, { store: opts.store })
    } catch (err) {
      console.warn("flight_api_cache write failed:", err)
    }
  }

  return dedupInFlight(cacheKey, async () => {
    // 1. Cache hit (positive or negative) within TTL — serve and skip API.
    if (!opts.bypassCache) {
      const cached = await safeGetCache()
      if (cached && isCacheFresh(cached, flightDate, FLIGHT_LOOKUP_SCHEMA_VERSION, now())) {
        return cached.notFound ? null : parseFlightResponse(cached.response as AeroDataBoxFlight)
      }
    }

    // 2. Rate-limit cooldown — don't hammer AeroDataBox. Serve stale cache if any.
    if (isRateLimited(now())) {
      const cached = opts.bypassCache ? await safeGetCache() : null
      if (cached?.response) return parseFlightResponse(cached.response as AeroDataBoxFlight)
      console.warn(`AeroDataBox cooldown active; skipping lookup for ${flightNumber} ${flightDate}`)
      return null
    }

    // 3. Live fetch.
    const apiKey = process.env.AERODATABOX_API_KEY
    if (!apiKey) {
      console.warn("AERODATABOX_API_KEY not set — flight lookup skipped")
      return null
    }

    const encoded = encodeURIComponent(flightNumber)
    // dateLocalRole=Departure: interpret flightDate as the departure airport's
    // local date. Without this, the API defaults to "Both" and may return the
    // previous-day occurrence when the flight crosses midnight UTC.
    const url = `https://${AERODATABOX_HOST}/flights/number/${encoded}/${flightDate}?dateLocalRole=Departure`
    const fetchImpl = opts.fetchImpl ?? $fetch

    let data: AeroDataBoxFlight[]
    try {
      data = await fetchImpl<AeroDataBoxFlight[]>(url, {
        headers: {
          "x-rapidapi-host": AERODATABOX_HOST,
          "x-rapidapi-key": apiKey,
        },
      })
    } catch (error: unknown) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404) {
        await safeSetCache({
          response: null,
          notFound: true,
          fetchedAt: now(),
          lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
        })
        return null
      }
      if (status === 429) {
        markRateLimited(now())
        console.warn(`AeroDataBox 429 for ${flightNumber} ${flightDate}; cooling down 60s`)
      } else {
        console.error("AeroDataBox API error:", error)
      }
      // Best-effort: serve whatever we have, even if stale.
      const stale = await safeGetCache()
      if (stale?.response) return parseFlightResponse(stale.response as AeroDataBoxFlight)
      return null
    }

    const flight = data[0]
    if (!flight) {
      // Empty array is the API saying "no occurrence for this date" — treat
      // identically to a 404 so we don't ask again until the negative TTL.
      await safeSetCache({
        response: null,
        notFound: true,
        fetchedAt: now(),
        lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
      })
      return null
    }

    await safeSetCache({
      response: flight as unknown as Record<string, unknown>,
      notFound: false,
      fetchedAt: now(),
      lookupSchemaVersion: FLIGHT_LOOKUP_SCHEMA_VERSION,
    })

    return parseFlightResponse(flight)
  })
}
