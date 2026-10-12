import { createError } from "h3"

/**
 * Return every ISO date string (YYYY-MM-DD) from `start` to `end` inclusive.
 * Both inputs must be valid YYYY-MM-DD strings. Caller enforces `end >= start`.
 */
export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = []
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  const cursor = new Date(startDate)
  while (cursor.getTime() <= endDate.getTime()) {
    out.push(cursor.toISOString().split("T")[0]!)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

export interface TripDateRange {
  startDate: string
  endDate: string
}

/**
 * The trip's date range after a (possibly partial) update, validated as a whole.
 *
 * The update schema can only compare the two dates when both are sent. A
 * start-only update past the stored end slipped through it, enumerated zero
 * days, and deleted every day on the trip (audit B11) — so the merged range is
 * what gets checked.
 */
export function resolveTripDateRange(
  stored: TripDateRange,
  update: Partial<TripDateRange>,
): TripDateRange {
  const startDate = update.startDate ?? stored.startDate
  const endDate = update.endDate ?? stored.endDate
  if (endDate < startDate) {
    throw createError({
      statusCode: 400,
      message: `The trip would end (${endDate}) before it starts (${startDate}).`,
    })
  }
  return { startDate, endDate }
}
