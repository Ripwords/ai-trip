interface ScheduleActivity {
  id: string
  name: string
  estimatedDurationMinutes: number | null
  lat?: number | null
  lng?: number | null
  openingMinutes?: number | null
  /** Intended start (minutes since midnight) — the slot the AI/traveler picked. */
  preferredMinutes?: number | null
}

interface TravelTime {
  fromId: string
  toId: string
  durationMinutes: number
}

interface ScheduledActivity {
  id: string
  suggestedTime: string
  sortOrder: number
}

/**
 * Computes non-overlapping start times for an ordered list of activities.
 *
 * Takes the AI-determined order and calculates proper times by:
 * 1. Starting at `startHour` (default 09:00)
 * 2. Each activity takes its `estimatedDurationMinutes` (default 60)
 * 3. Travel time between consecutive activities is added as a buffer
 * 4. A buffer of `bufferMinutes` (default 15) is added between activities
 * 5. If an activity has `openingMinutes`, the start time is pushed forward
 *    to at least that time (won't schedule before a place opens)
 * 6. If an activity has `preferredMinutes`, it never starts earlier than that —
 *    intentional gaps (a 19:30 dinner after a 14:00 beach) survive instead of
 *    being packed back-to-back
 *
 * This ensures no overlaps regardless of what the AI suggested.
 */
export function computeSchedule(params: {
  activities: ScheduleActivity[]
  travelTimes?: TravelTime[]
  startHour?: number
  startMinute?: number
  startTravelTimeMinutes?: number
  bufferMinutes?: number
}): ScheduledActivity[] {
  const {
    activities,
    travelTimes = [],
    startHour = 9,
    startMinute = 0,
    startTravelTimeMinutes = 0,
    bufferMinutes = 15,
  } = params

  if (activities.length === 0) return []

  const result: ScheduledActivity[] = []
  let currentMinutes = startHour * 60 + startMinute + Math.ceil(startTravelTimeMinutes)

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i]!

    // Add travel time from previous activity, then snap to the next 5-minute slot
    // so transitions don't leave odd start times like 09:48 or 10:33.
    if (i > 0) {
      const prevId = activities[i - 1]!.id
      const travel = travelTimes.find((t) => t.fromId === prevId && t.toId === activity.id)
      const travelMinutes = travel ? Math.ceil(travel.durationMinutes) : 0
      currentMinutes += travelMinutes + bufferMinutes
      currentMinutes = Math.ceil(currentMinutes / 5) * 5
    }

    // Never start before the intended slot — pushing later (overlap/travel)
    // is fine, pulling an evening activity into the morning is not.
    if (activity.preferredMinutes != null && currentMinutes < activity.preferredMinutes) {
      currentMinutes = activity.preferredMinutes
    }

    // If activity has opening hours, don't schedule before it opens
    if (activity.openingMinutes != null && currentMinutes < activity.openingMinutes) {
      currentMinutes = activity.openingMinutes
    }

    result.push({
      id: activity.id,
      suggestedTime: minutesToTime(currentMinutes),
      sortOrder: i,
    })

    // Advance clock by activity duration
    const duration = activity.estimatedDurationMinutes ?? 60
    currentMinutes += duration
  }

  return result
}

/**
 * Parses opening hours strings (e.g. "Monday: 9:00 AM – 5:00 PM") for a
 * specific day of the week and returns the opening time in minutes since midnight.
 *
 * @param openingHours - Array of strings like ["Monday: 9:00 AM – 5:00 PM", ...]
 * @param date - The date to check (used to determine day of week)
 * @returns Opening time in minutes since midnight, or null if not found / open 24h
 */
export function parseOpeningTime(
  openingHours: string[] | null | undefined,
  date: string,
): number | null {
  if (!openingHours || openingHours.length === 0) return null

  const dayOfWeek = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
  })

  // Find the entry for this day of the week
  const dayEntry = openingHours.find((h) => h.toLowerCase().startsWith(dayOfWeek.toLowerCase()))

  if (!dayEntry) return null

  // Check for "Closed"
  if (dayEntry.toLowerCase().includes("closed")) return null

  // Check for "Open 24 hours"
  if (dayEntry.toLowerCase().includes("24 hours")) return null

  // Parse time like "Monday: 9:00 AM – 5:00 PM" or "Monday: 09:00 – 17:00"
  const timeMatch = dayEntry.match(/:\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i)

  if (!timeMatch) return null

  let hours = parseInt(timeMatch[1]!)
  const minutes = parseInt(timeMatch[2]!)
  const period = timeMatch[3]?.toUpperCase()

  if (period === "PM" && hours !== 12) hours += 12
  if (period === "AM" && hours === 12) hours = 0

  return hours * 60 + minutes
}

/**
 * The open→close window for a venue on a given date, from its Google opening
 * hours. `parseOpeningTime` above returns only the open time (used to avoid
 * scheduling before a place opens); this returns both bounds so callers can
 * also catch "scheduled after it closes" and "closed that day".
 *
 * Returns "closed" when the day entry says Closed, and null when the window
 * can't be determined (no entry, "Open 24 hours", or fewer than two times) —
 * callers should skip rather than guess. `closeMinutes` may exceed 1440 when
 * the venue closes after midnight (e.g. a bar open until 2 AM).
 */
export function parseOpeningWindow(
  openingHours: string[] | null | undefined,
  date: string,
): { openMinutes: number; closeMinutes: number } | "closed" | null {
  if (!openingHours || openingHours.length === 0) return null

  const dayOfWeek = new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })
  const dayEntry = openingHours.find((h) => h.toLowerCase().startsWith(dayOfWeek.toLowerCase()))
  if (!dayEntry) return null

  const lower = dayEntry.toLowerCase()
  if (lower.includes("closed")) return "closed"
  if (lower.includes("24 hours") || lower.includes("open 24")) return null

  const tokens = [...dayEntry.matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)?/gi)]
  if (tokens.length < 2) return null

  const toMinutes = (m: RegExpMatchArray): number => {
    let hours = parseInt(m[1]!, 10)
    const minutes = parseInt(m[2]!, 10)
    const period = m[3]?.toUpperCase()
    if (period === "PM" && hours !== 12) hours += 12
    if (period === "AM" && hours === 12) hours = 0
    return hours * 60 + minutes
  }

  const times = tokens.map(toMinutes)
  const openMinutes = times[0]!
  let closeMinutes = times[times.length - 1]!
  if (closeMinutes <= openMinutes) closeMinutes += 24 * 60 // closes after midnight
  return { openMinutes, closeMinutes }
}

/** Parses a strict "HH:MM" clock time to minutes since midnight, or null. */
export function parseClockMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hours = parseInt(m[1]!, 10)
  const minutes = parseInt(m[2]!, 10)
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Orders a day's activities into a display/schedule order.
 *
 * Without `explicitOrderIds`: stable sort by suggested time, untimed entries
 * after all timed ones. With `explicitOrderIds` (e.g. an AI-optimized order):
 * listed ids come first in that order, anything unlisted follows sorted by time
 * — so a partial ordering can never strand an activity with a stale slot.
 */
export function orderDayActivities<T extends { id: string; suggestedTime: string | null }>(
  activities: T[],
  explicitOrderIds?: string[],
): T[] {
  const byTime = (list: T[]): T[] =>
    list
      .map((a, i) => ({ a, i, t: parseClockMinutes(a.suggestedTime) ?? Number.POSITIVE_INFINITY }))
      .toSorted((x, y) => x.t - y.t || x.i - y.i)
      .map((x) => x.a)

  if (!explicitOrderIds?.length) return byTime(activities)

  const byId = new Map(activities.map((a) => [a.id, a]))
  const head = explicitOrderIds.map((id) => byId.get(id)).filter((a): a is T => a != null)
  const headIds = new Set(head.map((a) => a.id))
  const rest = byTime(activities.filter((a) => !headIds.has(a.id)))
  return [...head, ...rest]
}

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}
