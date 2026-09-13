import { computed, type Ref } from "vue"
import { iataToCountry } from "../utils/iata-to-country"
import { departureInstant } from "#shared/utils/flight-order"

export interface FlightItem {
  id: string
  flightNumber: string
  flightDate: string
  departureAirport: string | null
  arrivalAirport: string | null
  /** UTC instants from the `timestamp with timezone` columns. */
  departureTime: string | null
  arrivalTime: string | null
  /**
   * Wall clock at the ARRIVAL airport as the airline reported it, e.g.
   * "2026-08-16 11:05+07:00" (`deriveFlightFields`). Null on rows the flight API
   * never enriched.
   */
  arrivalTimeLocal?: string | null
  [key: string]: unknown
}

export interface LayoverInfo {
  type: "layover"
  airport: string
  country: string | undefined
  durationMinutes: number | null
  arrivalFlight: FlightItem
  departureFlight: FlightItem
  arrivalTime: string | null
  /**
   * The layover airport's local arrival clock. The AI layover-tips prompt buckets
   * time-of-day off this — the UTC `arrivalTime` alone cannot say whether the
   * traveler lands at 3am or 3pm without knowing the airport's offset (issue #15).
   */
  arrivalTimeLocal: string | null
  departureTime: string | null
  recommendation: "stay" | "tight" | "explore"
  recommendationLabel: string
}

export interface FlightEntry {
  type: "flight"
  flight: FlightItem
}

export type FlightListItem = FlightEntry | LayoverInfo

function getRecommendation(
  durationMinutes: number | null,
): Pick<LayoverInfo, "recommendation" | "recommendationLabel"> {
  if (durationMinutes === null) {
    return { recommendation: "stay", recommendationLabel: "Connection detected" }
  }
  if (durationMinutes < 180) {
    return { recommendation: "stay", recommendationLabel: "Stay in airport" }
  }
  if (durationMinutes < 360) {
    return { recommendation: "tight", recommendationLabel: "Tight but possible" }
  }
  return { recommendation: "explore", recommendationLabel: "Go explore!" }
}

/** Check if two flight dates are the same day or consecutive days */
function areDatesClose(dateA: string, dateB: string): boolean {
  const a = new Date(dateA + "T00:00:00")
  const b = new Date(dateB + "T00:00:00")
  const diffDays = Math.abs(b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)
  return diffDays <= 1
}

/**
 * Compute layover duration in minutes from local display times.
 * Flights often cross timezone boundaries, so raw UTC timestamps can produce
 * negative diffs even when the local times are correct. We parse the arrival
 * and departure times and if the diff is negative (timezone artifact on the
 * same flightDate), we return null to indicate "connection detected" without
 * an exact duration.
 */
function computeLayoverMinutes(
  arrivalTime: string | null,
  departureTime: string | null,
): number | null {
  if (!arrivalTime || !departureTime) return null

  const arrivalMs = new Date(arrivalTime).getTime()
  const departureMs = new Date(departureTime).getTime()
  const diffMs = departureMs - arrivalMs

  // Negative or zero diff = timezone artifact, can't compute reliable duration
  if (diffMs <= 0) return null
  // More than 24 hours = unlikely to be a single layover
  if (diffMs > 24 * 60 * 60 * 1000) return null

  return Math.round(diffMs / 60000)
}

export function useLayoverDetection(flights: Ref<FlightItem[] | null>) {
  const flightListItems = computed<FlightListItem[]>(() => {
    const sorted = flights.value
    if (!sorted || sorted.length === 0) return []

    const items: FlightListItem[] = []

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!
      items.push({ type: "flight", flight: current })

      if (i === sorted.length - 1) continue
      const next = sorted[i + 1]!

      // Upcoming lists run oldest-first, past lists newest-first, so the
      // neighbour below a card is the leg that follows it in one direction and
      // the leg that fed it in the other. Read the pair chronologically.
      const [inbound, outbound] =
        departureInstant(current) <= departureInstant(next) ? [current, next] : [next, current]

      if (
        !inbound.arrivalAirport ||
        inbound.arrivalAirport !== outbound.departureAirport ||
        !areDatesClose(inbound.flightDate, outbound.flightDate)
      ) {
        continue
      }

      const durationMinutes = computeLayoverMinutes(inbound.arrivalTime, outbound.departureTime)
      const { recommendation, recommendationLabel } = getRecommendation(durationMinutes)

      items.push({
        type: "layover",
        airport: inbound.arrivalAirport,
        country: iataToCountry[inbound.arrivalAirport] ?? undefined,
        durationMinutes,
        arrivalFlight: inbound,
        departureFlight: outbound,
        arrivalTime: inbound.arrivalTime,
        arrivalTimeLocal: inbound.arrivalTimeLocal ?? null,
        departureTime: outbound.departureTime,
        recommendation,
        recommendationLabel,
      })
    }

    return items
  })

  /**
   * Flights whose arrival country already has a visa badge on the layover card
   * beside them. The layover is not always the card below — past lists run
   * newest-first — so match on the flight itself, not on list position.
   */
  const layoverCoveredFlightIds = computed(
    () =>
      new Set(
        flightListItems.value
          .filter((i): i is LayoverInfo => i.type === "layover" && !!i.country)
          .map((i) => i.arrivalFlight.id),
      ),
  )

  return { flightListItems, layoverCoveredFlightIds }
}
