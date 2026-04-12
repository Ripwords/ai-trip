import { computed, type Ref } from "vue"
import { iataToCountry } from "../utils/iata-to-country"

interface FlightItem {
  id: string
  flightNumber: string
  flightDate: string
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
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
  departureTime: string | null
  recommendation: "stay" | "tight" | "explore"
  recommendationLabel: string
}

export interface FlightEntry {
  type: "flight"
  flight: FlightItem
}

export type FlightListItem = FlightEntry | LayoverInfo

const MAX_LAYOVER_MS = 24 * 60 * 60 * 1000 // 24 hours

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

export function useLayoverDetection(flights: Ref<FlightItem[] | null>) {
  const flightListItems = computed<FlightListItem[]>(() => {
    const sorted = flights.value
    if (!sorted || sorted.length === 0) return []

    const items: FlightListItem[] = []

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!
      items.push({ type: "flight", flight: current })

      // Check if next flight forms a connection
      if (i < sorted.length - 1) {
        const next = sorted[i + 1]!

        if (
          current.arrivalAirport &&
          next.departureAirport &&
          current.arrivalAirport === next.departureAirport
        ) {
          let durationMinutes: number | null = null

          if (current.arrivalTime && next.departureTime) {
            const arrivalMs = new Date(current.arrivalTime).getTime()
            const departureMs = new Date(next.departureTime).getTime()
            const diffMs = departureMs - arrivalMs

            // Only treat as layover if within 24 hours and positive
            if (diffMs <= 0 || diffMs > MAX_LAYOVER_MS) continue

            durationMinutes = Math.round(diffMs / 60000)
          }

          const { recommendation, recommendationLabel } = getRecommendation(durationMinutes)

          items.push({
            type: "layover",
            airport: current.arrivalAirport,
            country: iataToCountry[current.arrivalAirport] ?? undefined,
            durationMinutes,
            arrivalFlight: current,
            departureFlight: next,
            arrivalTime: current.arrivalTime,
            departureTime: next.departureTime,
            recommendation,
            recommendationLabel,
          })
        }
      }
    }

    return items
  })

  return { flightListItems }
}
