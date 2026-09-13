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

function isPast(value: string | Date | null, now: number): boolean {
  const ms = instant(value)
  return ms !== null && ms <= now
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

/**
 * Has this leg already operated, as of the instant `now`?
 *
 * Actuals alone are not proof. AeroDataBox's `revisedTime` is the airline's own
 * estimate until the leg operates, so an upcoming delayed flight already reports
 * a non-null actual arrival for an arrival that has not happened. Comparing that
 * instant against the clock is what separates the estimate from the event.
 *
 * The UTC day is too coarse to ask this. It cannot tell a leg that landed an
 * hour ago from one still in the air, and it answers no all day for a leg the
 * traveler watched land this morning.
 */
export function hasFlown(flight: LegTimes, now: number = Date.now()): boolean {
  if (instant(flight.actualDepartureTime) === null) return false
  return isPast(flight.actualArrivalTime, now)
}

/**
 * Is the ground time between these two legs already behind the traveler?
 *
 * A layover has only two endpoints of its own: the inbound touching down and
 * the outbound pushing back. Once both are in the past the gap is spent and
 * measured, and a card about it can only state what happened.
 *
 * Asking `hasFlown` of both whole legs is a different, stricter question. It
 * waits on where the outbound is going, which is not part of the layover, so a
 * traveler already airborne out of the connection still gets advice about it.
 */
export function layoverIsOver(
  inbound: LegTimes,
  outbound: LegTimes,
  now: number = Date.now(),
): boolean {
  return isPast(inbound.actualArrivalTime, now) && isPast(outbound.actualDepartureTime, now)
}

/**
 * Ground time between two legs, read off ONE clock. Both ends come from the
 * named basis or the answer is null; there is no path that mixes a scheduled
 * arrival with an actual departure.
 *
 * Raw minutes, with none of the guards a caller may want: negative values from
 * rows filed out of order and implausibly long gaps both come back as-is.
 */
export function connectionMinutes(
  inbound: LegTimes,
  outbound: LegTimes,
  basis: "actual" | "scheduled",
): number | null {
  return basis === "actual"
    ? minutesBetween(inbound.actualArrivalTime, outbound.actualDepartureTime)
    : minutesBetween(inbound.scheduledArrivalTime, outbound.scheduledDepartureTime)
}
