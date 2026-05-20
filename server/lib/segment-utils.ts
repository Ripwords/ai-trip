import type { TransportMode } from "../utils/transport"

export interface MatrixEntry {
  status?: string
  duration?: { value: number; text: string }
  distance?: { value: number; text: string }
}

export interface SegmentData {
  durationSeconds: number | null
  distanceMeters: number | null
  durationText: string | null
  distanceText: string | null
  mode: TransportMode
}

export function pickSegmentData(
  primary: MatrixEntry | undefined,
  fallback: MatrixEntry | undefined,
  primaryMode: TransportMode,
  fallbackMode: TransportMode,
): SegmentData {
  const usePrimary = primary?.duration?.value != null
  if (usePrimary) {
    return {
      durationSeconds: primary.duration?.value ?? null,
      distanceMeters: primary.distance?.value ?? null,
      durationText: primary.duration?.text ?? null,
      distanceText: primary.distance?.text ?? null,
      mode: primaryMode,
    }
  }
  const hasFallback = fallback?.duration?.value != null
  return {
    durationSeconds: fallback?.duration?.value ?? null,
    distanceMeters: fallback?.distance?.value ?? null,
    durationText: fallback?.duration?.text ?? null,
    distanceText: fallback?.distance?.text ?? null,
    // When neither has data, keep the originally requested mode so the UI
    // can label the gap with the user's intent (e.g. "no transit route").
    mode: hasFallback ? fallbackMode : primaryMode,
  }
}

export function findMissingMatrixIndices(matrix: MatrixEntry[][], pairCount: number): number[] {
  const missing: number[] = []
  for (let i = 0; i < pairCount; i++) {
    const entry = matrix[i]?.[i]
    if (entry?.duration?.value == null) missing.push(i)
  }
  return missing
}

// Converts a wall-clock time in a given IANA timezone to a Unix-seconds
// timestamp. Uses Intl.DateTimeFormat to determine the timezone's UTC offset
// for the specific date (handles DST automatically). Returns NaN if the date
// or time strings are malformed.
export function zonedTimeToUtcSeconds(dayDate: string, time: string, timeZoneId: string): number {
  const dateMatch = dayDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})/)
  if (!dateMatch || !timeMatch) return NaN

  const year = parseInt(dateMatch[1]!, 10)
  const month = parseInt(dateMatch[2]!, 10)
  const day = parseInt(dateMatch[3]!, 10)
  const hour = parseInt(timeMatch[1]!, 10)
  const minute = parseInt(timeMatch[2]!, 10)

  // Treat the wall clock as if it were UTC, then shift by the zone's offset
  // measured at that moment (so DST is correct for the given date).
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetMs = getZoneOffsetMs(naiveUtc, timeZoneId)
  return Math.floor((naiveUtc - offsetMs) / 1000)
}

function getZoneOffsetMs(atMs: number, timeZoneId: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneId,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(atMs))) {
    if (p.type !== "literal") parts[p.type] = p.value
  }
  // en-US 24-hour format can emit "24" for midnight on some runtimes.
  const hour = parseInt(parts.hour!, 10)
  const tzAsUtc = Date.UTC(
    parseInt(parts.year!, 10),
    parseInt(parts.month!, 10) - 1,
    parseInt(parts.day!, 10),
    hour === 24 ? 0 : hour,
    parseInt(parts.minute!, 10),
    parseInt(parts.second!, 10),
  )
  return tzAsUtc - atMs
}

// Google Distance Matrix requires departure_time to be strictly in the future
// for transit. We round UP to the next hour so:
//   1. the cache key is stable for repeated calls within the same hour
//   2. the bucketed timestamp is never earlier than `now`
// (Rounding down with Math.floor can land the bucket in the past when `now`
// is mid-hour, which Google rejects with element-level ZERO_RESULTS.)
//
// When timeZoneId is provided, the activity time is interpreted as local
// wall-clock at the destination. Without it, the time is interpreted as UTC
// — fine for UTC destinations, but wrong by the destination's offset for
// anywhere else (e.g. 09:00 in NYC gets queried at 09:00 UTC = 05:00 EDT).
export function computeTransitDepartureTimestamp(
  dayDate: string,
  firstActivityTime: string | null,
  now: Date,
  timeZoneId?: string | null,
): number {
  const match = firstActivityTime?.match(/^(\d{1,2}):(\d{2})/)
  const hour = match ? parseInt(match[1]!, 10) : 9
  const minute = match ? parseInt(match[2]!, 10) : 0
  const hh = String(hour).padStart(2, "0")
  const mm = String(minute).padStart(2, "0")

  const target = timeZoneId
    ? zonedTimeToUtcSeconds(dayDate, `${hh}:${mm}`, timeZoneId)
    : Math.floor(new Date(`${dayDate}T${hh}:${mm}:00Z`).getTime() / 1000)
  const minimum = Math.floor(now.getTime() / 1000) + 60
  const picked = Math.max(Number.isFinite(target) ? target : minimum, minimum)

  return Math.ceil(picked / 3600) * 3600
}
