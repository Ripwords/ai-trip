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
