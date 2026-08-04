/**
 * Formatting for plain `YYYY-MM-DD` calendar dates.
 *
 * These must never go through `new Date(s)`: that parses a bare date string as
 * UTC midnight, and every subsequent render resolves it in the viewer's local
 * zone — so anyone west of UTC sees the previous day. Parsing the parts by hand
 * keeps a calendar date a calendar date.
 */

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

function parts(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/** e.g. "2026-08-04" -> "Aug 4, 2026". Returns "" for anything unparseable. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return ""
  const p = parts(value)
  if (!p) return ""
  return `${MONTHS_SHORT[p.m - 1]} ${p.d}, ${p.y}`
}

/** Today as `YYYY-MM-DD` in the *local* zone — what a date input expects. */
export function todayCalendarDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
