/**
 * The flight statuses the app shows. AeroDataBox reports its own vocabulary
 * ("Arrived", "Canceled", "EnRoute", ...), so every status is folded onto this
 * set when it is ingested, and again when it is read, because rows stored
 * before ingest normalised still carry the provider's spelling.
 */
export const FLIGHT_STATUSES = [
  "scheduled",
  "departed",
  "delayed",
  "landed",
  "cancelled",
  "diverted",
] as const

export type FlightStatus = (typeof FLIGHT_STATUSES)[number]

const ALIASES: Readonly<Record<string, FlightStatus>> = {
  scheduled: "scheduled",
  expected: "scheduled",
  checkin: "scheduled",
  boarding: "scheduled",
  gateclosed: "scheduled",
  unknown: "scheduled",
  departed: "departed",
  enroute: "departed",
  approaching: "departed",
  delayed: "delayed",
  arrived: "landed",
  landed: "landed",
  canceled: "cancelled",
  cancelled: "cancelled",
  canceleduncertain: "cancelled",
  diverted: "diverted",
}

/** Fold any stored or provider status onto the canonical set; unknown reads as scheduled. */
export function normalizeFlightStatus(status: string | null | undefined): FlightStatus {
  if (!status) return "scheduled"
  return ALIASES[status.toLowerCase().replace(/[^a-z]/g, "")] ?? "scheduled"
}
