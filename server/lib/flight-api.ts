const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com"

interface AeroDataBoxFlight {
  airline?: { name?: string }
  flight?: { number?: string; iataNumber?: string }
  departure?: {
    airport?: { iata?: string; name?: string }
    scheduledTime?: { local?: string; utc?: string }
    terminal?: string
    gate?: string
  }
  arrival?: {
    airport?: { iata?: string; name?: string }
    scheduledTime?: { local?: string; utc?: string }
    terminal?: string
    gate?: string
  }
  status?: string
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
  const url = `https://${AERODATABOX_HOST}/flights/number/${encoded}/${flightDate}`

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
