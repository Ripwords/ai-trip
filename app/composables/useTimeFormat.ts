/**
 * Formats a 24hr time string (HH:MM) to 12hr format (h:mm a).
 * Returns the original string if it can't be parsed.
 */
export function formatTime12h(time: string | null | undefined): string {
  if (!time) return ""
  const dayjs = useDayjs()
  const parsed = dayjs(`2000-01-01 ${time}`)
  if (!parsed.isValid()) return time
  return parsed.format("h:mm A")
}
