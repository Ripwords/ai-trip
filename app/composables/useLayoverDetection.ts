import { computed, type Ref } from "vue"
import { iataToCountry } from "../utils/iata-to-country"
import { departureInstant } from "#shared/utils/flight-order"
import { connectionMinutes, hasFlown, type LegTimes } from "#shared/utils/flight-times"

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
   * The booked pair and the operated pair, kept apart. `departureTime` and
   * `arrivalTime` above coalesce them per end, which is safe to display and
   * unsafe to subtract.
   */
  scheduledDepartureTime: string | null
  actualDepartureTime: string | null
  scheduledArrivalTime: string | null
  actualArrivalTime: string | null
  /**
   * Wall clock at the ARRIVAL airport as the airline reported it, e.g.
   * "2026-08-16 11:05+07:00" (`deriveFlightFields`). Null on rows the flight API
   * never enriched.
   */
  arrivalTimeLocal?: string | null
  [key: string]: unknown
}

interface LayoverBase {
  type: "layover"
  airport: string
  country: string | undefined
  /** Headline value. This is what `/api/ai/layover-tips` is posted. */
  durationMinutes: number | null
  /** Inbound `scheduledArrivalTime` to outbound `scheduledDepartureTime`. */
  scheduledMinutes: number | null
  /** Inbound `actualArrivalTime` to outbound `actualDepartureTime`. */
  actualMinutes: number | null
  /** Which clock `durationMinutes` was read off. */
  basis: "actual" | "scheduled"
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
}

/**
 * A layover is either still ahead of the traveler, in which case the card
 * advises, or already behind them, in which case it can only state what
 * happened. The union is what stops a retrospective card carrying advice.
 */
export type LayoverInfo =
  | (LayoverBase & { retrospective: true; recommendation: null; recommendationLabel: null })
  | (LayoverBase & {
      retrospective: false
      recommendation: "stay" | "tight" | "explore"
      recommendationLabel: string
    })

export interface FlightEntry {
  type: "flight"
  flight: FlightItem
}

export type FlightListItem = FlightEntry | LayoverInfo

function getRecommendation(
  durationMinutes: number | null,
): Pick<LayoverInfo & { retrospective: false }, "recommendation" | "recommendationLabel"> {
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
 * Layover duration in minutes, both ends read off the named clock.
 * Flights often cross timezone boundaries, so raw UTC timestamps can produce
 * negative diffs even when the local times are correct. If the diff is negative
 * (timezone artifact on the same flightDate), we return null to indicate
 * "connection detected" without an exact duration.
 */
function computeLayoverMinutes(
  inbound: LegTimes,
  outbound: LegTimes,
  basis: "actual" | "scheduled",
): number | null {
  const diff = connectionMinutes(inbound, outbound, basis)
  if (diff === null) return null

  // Negative or zero diff = timezone artifact, can't compute reliable duration
  if (diff <= 0) return null
  // More than 24 hours = unlikely to be a single layover
  if (diff > 24 * 60) return null

  return diff
}

export function useLayoverDetection(
  flights: Ref<FlightItem[] | null>,
  todayIso: string = new Date().toISOString().split("T")[0]!,
) {
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

      const scheduledMinutes = computeLayoverMinutes(inbound, outbound, "scheduled")
      const actualMinutes = computeLayoverMinutes(inbound, outbound, "actual")
      const retrospective = hasFlown(inbound, todayIso) && hasFlown(outbound, todayIso)

      const minutesByBasis = { actual: actualMinutes, scheduled: scheduledMinutes }
      const preference: ("actual" | "scheduled")[] = retrospective
        ? ["actual", "scheduled"]
        : ["scheduled", "actual"]
      const basis = preference.find((clock) => minutesByBasis[clock] !== null) ?? "scheduled"
      const durationMinutes = minutesByBasis[basis]

      const base = {
        type: "layover",
        airport: inbound.arrivalAirport,
        country: iataToCountry[inbound.arrivalAirport] ?? undefined,
        durationMinutes,
        scheduledMinutes,
        actualMinutes,
        basis,
        arrivalFlight: inbound,
        departureFlight: outbound,
        arrivalTime: inbound.arrivalTime,
        arrivalTimeLocal: inbound.arrivalTimeLocal ?? null,
        departureTime: outbound.departureTime,
      } satisfies LayoverBase

      items.push(
        retrospective
          ? { ...base, retrospective: true, recommendation: null, recommendationLabel: null }
          : { ...base, retrospective: false, ...getRecommendation(durationMinutes) },
      )
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
