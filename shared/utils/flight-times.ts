/**
 * A leg's four clock readings, kept apart so a delay can never be mistaken for
 * a change to the booking.
 *
 * Each field is a `Date` when it comes straight off a Drizzle row and an ISO
 * string once it has been through JSON on the way to the browser, the same way
 * `OrderableFlight` in ./flight-order.ts sees them.
 */
export interface LegTimes {
  scheduledDepartureTime: string | Date | null
  actualDepartureTime: string | Date | null
  scheduledArrivalTime: string | Date | null
  actualArrivalTime: string | Date | null
}

const MINUTE_MS = 60_000

function instant(value: string | Date | null): number | null {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function minutesBetween(from: string | Date | null, to: string | Date | null): number | null {
  const start = instant(from)
  const end = instant(to)
  if (start === null || end === null) return null
  return Math.round((end - start) / MINUTE_MS)
}

/** Minutes late off the gate. Negative when the flight pushed back early, null when unknown. */
export function departureDelayMinutes(flight: LegTimes): number | null {
  return minutesBetween(flight.scheduledDepartureTime, flight.actualDepartureTime)
}

/** Minutes late onto the stand. Negative when the flight arrived early, null when unknown. */
export function arrivalDelayMinutes(flight: LegTimes): number | null {
  return minutesBetween(flight.scheduledArrivalTime, flight.actualArrivalTime)
}

/**
 * Gate-to-gate duration, and which clock it was read off.
 *
 * Both endpoints come from the same pair or the answer is refused. Mixing an
 * actual departure with a scheduled arrival would silently subtract the
 * departure delay from the flight time, which is how a delayed leg ends up
 * looking shorter than the one that was booked.
 */
export function blockMinutes(
  flight: LegTimes,
): { minutes: number; basis: "actual" | "scheduled" } | null {
  const actual = minutesBetween(flight.actualDepartureTime, flight.actualArrivalTime)
  if (actual !== null) return { minutes: actual, basis: "actual" }

  const scheduled = minutesBetween(flight.scheduledDepartureTime, flight.scheduledArrivalTime)
  if (scheduled !== null) return { minutes: scheduled, basis: "scheduled" }

  return null
}
