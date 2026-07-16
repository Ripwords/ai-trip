/**
 * Normalize an AI-produced start time to strict zero-padded HH:MM.
 * Returns null for anything unparseable or out of range — the schedule
 * engine treats null as "fill this in".
 */
export function normalizeSuggestedTime(t: string | null | undefined): string | null {
  if (!t) return null
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hours = parseInt(m[1]!, 10)
  const minutes = parseInt(m[2]!, 10)
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

/** Clamp an AI-produced venue duration to a sane range (5 min – 12 h). */
export function clampDurationMinutes(d: number | null | undefined): number | null {
  if (d == null || !Number.isFinite(d)) return null
  return Math.min(720, Math.max(5, Math.round(d)))
}
