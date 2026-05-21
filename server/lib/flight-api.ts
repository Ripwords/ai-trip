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

/**
 * Look up a flight by number and date from AeroDataBox.
 * Returns null if the flight is not found or the API key is not configured.
 */
export async function lookupFlight(
  flightNumber: string,
  flightDate: string,
): Promise<FlightLookupResult | null> {
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

  let data: AeroDataBoxFlight[]
  try {
    data = await $fetch<AeroDataBoxFlight[]>(url, {
      headers: {
        "x-rapidapi-host": AERODATABOX_HOST,
        "x-rapidapi-key": apiKey,
      },
    })
  } catch (error: unknown) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 404) return null
    console.error("AeroDataBox API error:", error)
    return null
  }

  // The API may return multiple legs; take the first one
  const flight = data[0]
  if (!flight) return null

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
