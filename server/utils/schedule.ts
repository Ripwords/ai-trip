interface ScheduleActivity {
  id: string
  name: string
  estimatedDurationMinutes: number | null
  lat: number | null
  lng: number | null
  openingMinutes?: number | null
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

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}
