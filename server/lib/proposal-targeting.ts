export interface DayRef {
  id: string
  dayNumber: number
}

type Resolved<T> = { ok: true } & T
type Failed = { ok: false; error: string }

/**
 * Pick the day a proposal targets: an explicit model-chosen dayId if given
 * (validated against the trip's days), otherwise the currently-open day.
 * Mirrors validateActivityIds' defense — a dayId the agent invents is rejected.
 */
export function resolveTargetDay(
  days: DayRef[],
  activeDayId: string,
  dayId?: string,
): Resolved<{ dayId: string }> | Failed {
  const target = dayId ?? activeDayId
  if (!target) {
    return { ok: false, error: "No day in scope. Ask the user which day (or 'all days')." }
  }
  if (!days.some((d) => d.id === target)) {
    return {
      ok: false,
      error: `Unknown dayId "${target}". Use a [day:…] id from the trip context.`,
    }
  }
  return { ok: true, dayId: target }
}

/**
 * Resolve one or many target days. `dayIds` (fan-out, e.g. "every morning")
 * takes precedence; then a single `dayId`; then the active day.
 */
export function resolveTargetDays(
  days: DayRef[],
  activeDayId: string,
  opts: { dayId?: string; dayIds?: string[] },
): Resolved<{ dayIds: string[] }> | Failed {
  if (opts.dayIds && opts.dayIds.length > 0) {
    for (const id of opts.dayIds) {
      if (!days.some((d) => d.id === id)) {
        return { ok: false, error: `Unknown dayId "${id}". Use [day:…] ids from the trip context.` }
      }
    }
    return { ok: true, dayIds: [...opts.dayIds] }
  }
  const single = resolveTargetDay(days, activeDayId, opts.dayId)
  return single.ok ? { ok: true, dayIds: [single.dayId] } : single
}

/** Stamp a shared groupId across proposals produced in one turn (>1 only). */
export function stampGroup<T extends { groupId?: string }>(items: T[], groupId: string): T[] {
  if (items.length <= 1) return items
  return items.map((it) => ({ ...it, groupId }))
}
