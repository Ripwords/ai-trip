import { createHash } from "node:crypto"

/**
 * Cache key for the web-research pass: a readable destination slug plus a
 * short hash of destination+context. User text never appears raw in the key
 * (context strings are user prompts), and the result is storage-safe.
 * Hash uses JSON encoding to avoid delimiter collisions (e.g., "tokyo::kyoto"+"food"
 * vs "tokyo"+"kyoto::food" are now distinct).
 */
export function researchCacheKey(destination: string, userContext?: string): string {
  const dest = destination.toLowerCase().trim()
  const ctx = (userContext ?? "").toLowerCase().trim()
  const slug = dest
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
  const hash = createHash("sha256")
    .update(JSON.stringify([dest, ctx]))
    .digest("hex")
    .slice(0, 16)
  return `${slug}-${hash}`
}

// ── Layover tips cache ────────────────────────────────────────────────

export type TimeOfDayBucket = "night" | "morning" | "afternoon" | "evening" | "unknown"

/**
 * Coarse arrival-time bucket for the layover-tips cache key and prompt.
 *
 * The hour is read off the ISO string textually when it carries no timezone
 * designator: an arrival time is a LOCAL airport clock time, so interpreting it
 * in the server's timezone (as `new Date(...).getHours()` does) would move a 3am
 * arrival into a different bucket depending on the deploy region.
 */
export function timeOfDayBucket(arrivalTime: string | null | undefined): TimeOfDayBucket {
  if (!arrivalTime) return "unknown"

  let hour: number | null = null

  const bareLocal = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):\d{2}/.exec(arrivalTime)
  if (bareLocal && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(arrivalTime)) {
    hour = Number(bareLocal[1])
  } else {
    const parsed = new Date(arrivalTime)
    if (!Number.isNaN(parsed.getTime())) hour = parsed.getHours()
  }

  if (hour === null || !Number.isFinite(hour) || hour < 0 || hour > 23) return "unknown"
  if (hour < 6) return "night"
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

/**
 * Cache key for layover tips.
 *
 * `timeOfDay` is part of the key on purpose: the prompt feeds it to the model and
 * the whole `returnBy` / opening-hours answer depends on it, so a 3am arrival must
 * not be served the cached noon answer (issue #15). It is a coarse bucket rather
 * than a clock time so the key still hits for two travellers on the same flight.
 */
export function layoverTipsCacheKey(
  airport: string,
  durationHours: number,
  visaStatus: string,
  timeOfDay: string,
): string {
  return [
    airport.toLowerCase().trim(),
    durationHours,
    visaStatus.toLowerCase().trim(),
    timeOfDay.toLowerCase().trim(),
  ].join(":")
}

/** Never cache failed or sanitization-dropped research (empty string). */
export function isCacheableResearch(value: unknown): boolean {
  return typeof value === "string" && value.length > 0
}
