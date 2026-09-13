import {
  arrivalDelayMinutes,
  departureDelayMinutes,
  type LegTimes,
} from "#shared/utils/flight-times"

/** `45m`, `6h`, `8h 13m`. Negative spans are formatted as their magnitude. */
export function formatDuration(minutes: number): string {
  const total = Math.abs(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function delayClause(flightNumber: string, verb: string, minutes: number | null): string | null {
  if (minutes === null || minutes === 0) return null
  return `${flightNumber} ${verb} ${formatDuration(minutes)} ${minutes > 0 ? "late" : "early"}`
}

/**
 * The factual line under a flown layover's headline, e.g.
 * "Booked 6h · EK76 left 2h 13m late". Null when there is nothing factual to add.
 */
export function layoverFactLine(input: {
  scheduledMinutes: number | null
  inboundFlightNumber: string
  inboundArrivalDelayMinutes: number | null
  outboundFlightNumber: string
  outboundDepartureDelayMinutes: number | null
}): string | null {
  const clauses = [
    input.scheduledMinutes === null ? null : `Booked ${formatDuration(input.scheduledMinutes)}`,
    delayClause(input.inboundFlightNumber, "landed", input.inboundArrivalDelayMinutes),
    delayClause(input.outboundFlightNumber, "left", input.outboundDepartureDelayMinutes),
  ].filter((clause): clause is string => clause !== null)

  return clauses.length === 0 ? null : clauses.join(" · ")
}

export interface DelayNote {
  /** e.g. "Left 2h 13m late" or "Landed 20m early". */
  label: string
  /** The scheduled instant it slipped from; the card renders it with NuxtTime. */
  scheduledTime: string
  tone: "late" | "early"
}

function delayNote(
  verb: string,
  scheduled: string | Date | null,
  minutes: number | null,
): DelayNote | null {
  if (minutes === null || minutes === 0 || !scheduled) return null
  return {
    label: `${verb} ${formatDuration(minutes)} ${minutes > 0 ? "late" : "early"}`,
    scheduledTime: new Date(scheduled).toISOString(),
    tone: minutes > 0 ? "late" : "early",
  }
}

/** Departure then arrival, each present only when that delay is non-null and non-zero. */
export function delayNotes(flight: LegTimes): DelayNote[] {
  return [
    delayNote("Left", flight.scheduledDepartureTime, departureDelayMinutes(flight)),
    delayNote("Landed", flight.scheduledArrivalTime, arrivalDelayMinutes(flight)),
  ].filter((note): note is DelayNote => note !== null)
}
