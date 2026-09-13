export interface OrderableFlight {
  /**
   * The itinerary date the row was filed under: what the traveler typed, or the
   * `Date` column of a Flighty export. It is a label, not the departure date —
   * a connection that boards after local midnight carries the previous day's
   * label.
   */
  flightDate: string
  /**
   * Departure instant from the `timestamp with timezone` column. A `Date` when
   * it comes straight off a Drizzle row, an ISO string once it has been through
   * JSON on the way to the browser.
   */
  departureTime: string | Date | null
}

const MIDNIGHT_UTC_SUFFIX = "T00:00:00Z"

/**
 * When a flight actually leaves, as milliseconds since the epoch.
 *
 * Ordering has to key on this rather than on `flightDate`. Cross enough
 * timezones and a leg departs on the calendar day after the one it is filed
 * under, and a `flightDate`-first sort drops it into the wrong day's bucket —
 * where a time-of-day tiebreak then strands the 05:24 connection below the
 * 22:27 red-eye that fed it.
 *
 * Rows the flight API never enriched have no time; they fall back to their
 * label at midnight UTC, which keeps them among the flights they belong with
 * instead of at the end of the list.
 */
export function departureInstant(flight: OrderableFlight): number {
  if (flight.departureTime) {
    const parsed =
      flight.departureTime instanceof Date
        ? flight.departureTime.getTime()
        : Date.parse(flight.departureTime)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.parse(flight.flightDate + MIDNIGHT_UTC_SUFFIX)
}

/** Ascending by departure instant. Negate the result for newest-first. */
export function compareFlightsByDeparture(a: OrderableFlight, b: OrderableFlight): number {
  return departureInstant(a) - departureInstant(b)
}

/**
 * Has this flight not left yet, as of the UTC day `todayIso` names?
 *
 * Same day boundary the lists have always used, read off the departure instant
 * rather than the `flightDate` label: a red-eye that boards at 00:30 today is
 * still filed under yesterday, and must not be listed as already flown.
 */
export function isUpcomingFlight(flight: OrderableFlight, todayIso: string): boolean {
  return departureInstant(flight) >= Date.parse(todayIso + MIDNIGHT_UTC_SUFFIX)
}
