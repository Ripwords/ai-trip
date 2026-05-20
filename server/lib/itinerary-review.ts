export type ItineraryReviewScope = "day" | "trip"
export type ItineraryReviewSeverity = "critical" | "warning" | "suggestion"

export interface ReviewableActivity {
  id: string
  name: string
  type: string
  lat: number | null
  lng: number | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  sortOrder: number
  tags?: string[] | null
}

export interface ReviewableTravelSegment {
  fromActivityId: string
  toActivityId?: string | null
  durationSeconds?: number | null
  durationText?: string | null
  distanceText?: string | null
}

export interface ReviewableDay {
  id: string
  dayNumber: number
  date: string
  accommodationName: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
  activities: ReviewableActivity[]
  travelSegments: ReviewableTravelSegment[]
}

export interface ReviewableTrip {
  id: string
  destination?: string
  days: ReviewableDay[]
}

export interface ItineraryReviewOptions {
  scope: ItineraryReviewScope
  dayId?: string
}

import type { Proposal } from "./proposals"

export interface ItineraryReviewFinding {
  id: string
  code:
    | "missing-start-point"
    | "missing-accommodation-coordinates"
    | "missing-activity-time"
    | "missing-activity-duration"
    | "activity-overlap"
    | "long-travel-segment"
    | "missing-lunch"
    | "missing-dinner"
    | "late-ending"
    | "missing-activity-coordinates"
    | "pace-mismatch"
    | "backtracking-route"
    | "closed-on-date"
    | "interest-mismatch"
    | "energy-imbalance"
  severity: ItineraryReviewSeverity
  title: string
  message: string
  recommendation: string
  dayId: string
  dayNumber: number
  activityIds?: string[]
  proposal?: Proposal
}

export interface ItineraryReviewResult {
  scope: ItineraryReviewScope
  dayId?: string
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>
  summary: {
    checkedDays: number
    checkedActivities: number
    totalFindings: number
    critical: number
    warning: number
    suggestion: number
  }
}

export function formatItineraryReviewMessage(result: ItineraryReviewResult): string {
  const scopeLabel = result.scope === "trip" ? "trip" : "day"
  const { summary } = result

  if (summary.totalFindings === 0) {
    return `I reviewed this ${scopeLabel}. No timing, routing, meal, or start-point issues stood out.`
  }

  const counts = [
    summary.critical > 0 ? `${summary.critical} critical` : null,
    summary.warning > 0 ? `${summary.warning} warning${summary.warning === 1 ? "" : "s"}` : null,
    summary.suggestion > 0
      ? `${summary.suggestion} suggestion${summary.suggestion === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean)

  // Group findings by (dayId, code) so N copies of the same issue collapse into one line.
  const all = [
    ...result.findings.critical,
    ...result.findings.warning,
    ...result.findings.suggestion,
  ]
  const groups = new Map<string, { sample: (typeof all)[number]; count: number }>()
  for (const f of all) {
    const key = `${f.dayId}:${f.code}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { sample: f, count: 1 })
  }

  const topFindings = Array.from(groups.values())
    .slice(0, 3)
    .map(({ sample, count }) => {
      const label = count > 1 ? `${count} ${sample.title.toLowerCase()}` : sample.title
      return `Day ${sample.dayNumber}: ${label}. ${sample.recommendation}`
    })

  return `I found ${summary.totalFindings} ${summary.totalFindings === 1 ? "issue" : "issues"} in this ${scopeLabel}: ${counts.join(", ")}. ${topFindings.join(" ")}`
}

interface TimedActivity {
  activity: ReviewableActivity
  startMinutes: number
  endMinutes: number
}

const MEAL_TERMS = ["restaurant", "cafe", "bar", "food", "lunch", "dinner", "breakfast", "meal"]
const LONG_TRAVEL_SECONDS = 60 * 60
const VERY_LONG_TRAVEL_SECONDS = 90 * 60

export function reviewItinerary(
  trip: ReviewableTrip,
  options: ItineraryReviewOptions,
): ItineraryReviewResult {
  const days = selectDays(trip.days, options)
  const findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]> = {
    critical: [],
    warning: [],
    suggestion: [],
  }
  const allDays = trip.days.toSorted((a, b) => a.dayNumber - b.dayNumber)

  for (const day of days) {
    const previousDay = allDays.find((candidate) => candidate.dayNumber === day.dayNumber - 1)
    reviewDay(day, findings, previousDay)
  }

  return {
    scope: options.scope,
    dayId: options.scope === "day" ? options.dayId : undefined,
    findings,
    summary: {
      checkedDays: days.length,
      checkedActivities: days.reduce((sum, day) => sum + day.activities.length, 0),
      totalFindings:
        findings.critical.length + findings.warning.length + findings.suggestion.length,
      critical: findings.critical.length,
      warning: findings.warning.length,
      suggestion: findings.suggestion.length,
    },
  }
}

function selectDays(days: ReviewableDay[], options: ItineraryReviewOptions): ReviewableDay[] {
  if (options.scope === "trip") return days
  const day = days.find((candidate) => candidate.id === options.dayId)
  if (!day) throw new Error("Day not found")
  return [day]
}

function reviewDay(
  day: ReviewableDay,
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
  previousDay?: ReviewableDay,
) {
  const activities = day.activities.toSorted((a, b) => a.sortOrder - b.sortOrder)
  const timedActivities: TimedActivity[] = []

  addDayLevelFindings(day, findings, previousDay)

  for (const activity of activities) {
    if (!hasCoordinates(activity.lat, activity.lng)) {
      addFinding(findings, {
        code: "missing-activity-coordinates",
        severity: "warning",
        title: "Activity is missing coordinates",
        message: `${activity.name} does not have complete map coordinates.`,
        recommendation:
          "Open the activity and choose a mapped place so routing and map views stay accurate.",
        dayId: day.id,
        dayNumber: day.dayNumber,
        activityIds: [activity.id],
      })
    }

    const startMinutes = parseClockTime(activity.suggestedTime)
    if (startMinutes == null) {
      addFinding(findings, {
        code: "missing-activity-time",
        severity: "warning",
        title: "Activity is missing a start time",
        message: `${activity.name} has no scheduled time.`,
        recommendation:
          "Add a start time so the day can be checked for gaps, meal breaks, and overlaps.",
        dayId: day.id,
        dayNumber: day.dayNumber,
        activityIds: [activity.id],
      })
      continue
    }

    if (!activity.estimatedDurationMinutes || activity.estimatedDurationMinutes <= 0) {
      addFinding(findings, {
        code: "missing-activity-duration",
        severity: "warning",
        title: "Activity is missing a duration",
        message: `${activity.name} has no estimated duration.`,
        recommendation:
          "Add an estimated duration so the review can check whether the next stop is feasible.",
        dayId: day.id,
        dayNumber: day.dayNumber,
        activityIds: [activity.id],
      })
      continue
    }

    timedActivities.push({
      activity,
      startMinutes,
      endMinutes: startMinutes + activity.estimatedDurationMinutes,
    })
  }

  addOverlapFindings(day, timedActivities, findings)
  addTravelFindings(day, findings)
  addMealFindings(day, activities, timedActivities, findings)
  addLateEndingFinding(day, timedActivities, findings)
}

function addDayLevelFindings(
  day: ReviewableDay,
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
  previousDay?: ReviewableDay,
) {
  const startName = previousDay?.accommodationName ?? day.accommodationName
  const startAddress = previousDay?.accommodationAddress ?? day.accommodationAddress
  const startLat = previousDay?.accommodationLat ?? day.accommodationLat
  const startLng = previousDay?.accommodationLng ?? day.accommodationLng

  if (!startName && !startAddress) {
    addFinding(findings, {
      code: "missing-start-point",
      severity: "warning",
      title: "Day is missing a start point",
      message: `Day ${day.dayNumber} does not have accommodation or another starting location.`,
      recommendation:
        "Add the hotel or start address so transfer times can be judged from a realistic base.",
      dayId: day.id,
      dayNumber: day.dayNumber,
    })
    return
  }

  if (!hasCoordinates(startLat, startLng)) {
    addFinding(findings, {
      code: "missing-accommodation-coordinates",
      severity: "warning",
      title: "Start point is missing coordinates",
      message:
        previousDay?.accommodationName && !day.accommodationName
          ? `Day ${day.dayNumber} starts from Day ${previousDay.dayNumber}'s accommodation, but it is missing map coordinates.`
          : `Day ${day.dayNumber}'s accommodation is missing map coordinates.`,
      recommendation:
        "Choose a mapped accommodation place so the itinerary can calculate routes reliably.",
      dayId: day.id,
      dayNumber: day.dayNumber,
    })
  }
}

function addOverlapFindings(
  day: ReviewableDay,
  timedActivities: TimedActivity[],
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
) {
  const sorted = timedActivities.toSorted((a, b) => a.startMinutes - b.startMinutes)

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!
    const next = sorted[i + 1]!
    if (current.endMinutes <= next.startMinutes) continue

    addFinding(findings, {
      code: "activity-overlap",
      severity: "critical",
      title: "Activities overlap",
      message: `${current.activity.name} runs until ${formatClockTime(
        current.endMinutes,
      )}, which overlaps ${next.activity.name} at ${formatClockTime(next.startMinutes)}.`,
      recommendation: "Shorten one activity, move the next start time later, or reorder the day.",
      dayId: day.id,
      dayNumber: day.dayNumber,
      activityIds: [current.activity.id, next.activity.id],
    })
  }
}

function addTravelFindings(
  day: ReviewableDay,
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
) {
  const activityNameById = new Map(day.activities.map((activity) => [activity.id, activity.name]))

  for (const segment of day.travelSegments) {
    const durationSeconds = segment.durationSeconds ?? parseDurationText(segment.durationText)
    if (durationSeconds == null || durationSeconds <= LONG_TRAVEL_SECONDS) continue

    const fromName = activityNameById.get(segment.fromActivityId) ?? "an activity"
    const toName = segment.toActivityId ? activityNameById.get(segment.toActivityId) : undefined

    addFinding(findings, {
      code: "long-travel-segment",
      severity: durationSeconds > VERY_LONG_TRAVEL_SECONDS ? "critical" : "warning",
      title: "Long travel segment",
      message: `Travel from ${fromName}${toName ? ` to ${toName}` : ""} takes about ${formatDuration(
        durationSeconds,
      )}.`,
      recommendation:
        "Consider grouping nearby stops, changing transport mode, or moving one stop to another day.",
      dayId: day.id,
      dayNumber: day.dayNumber,
      activityIds: [segment.fromActivityId, segment.toActivityId].filter(Boolean) as string[],
    })
  }
}

function addMealFindings(
  day: ReviewableDay,
  activities: ReviewableActivity[],
  timedActivities: TimedActivity[],
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
) {
  if (timedActivities.length === 0) return

  const firstStart = Math.min(...timedActivities.map((entry) => entry.startMinutes))
  const lastEnd = Math.max(...timedActivities.map((entry) => entry.endMinutes))

  if (firstStart < minutes(12, 0) && lastEnd > minutes(13, 30) && !hasMeal(activities, "lunch")) {
    addFinding(findings, {
      code: "missing-lunch",
      severity: "suggestion",
      title: "Lunch break may be missing",
      message: `Day ${day.dayNumber} is active through lunch without a clear lunch stop.`,
      recommendation: "Add a restaurant, cafe, or explicit lunch break around midday.",
      dayId: day.id,
      dayNumber: day.dayNumber,
    })
  }

  if (firstStart < minutes(18, 30) && lastEnd > minutes(19, 30) && !hasMeal(activities, "dinner")) {
    addFinding(findings, {
      code: "missing-dinner",
      severity: "suggestion",
      title: "Dinner break may be missing",
      message: `Day ${day.dayNumber} continues into dinner time without a clear dinner stop.`,
      recommendation: "Add dinner or leave a visible evening gap before late activities.",
      dayId: day.id,
      dayNumber: day.dayNumber,
    })
  }
}

function addLateEndingFinding(
  day: ReviewableDay,
  timedActivities: TimedActivity[],
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
) {
  if (timedActivities.length === 0) return

  const latest = timedActivities.reduce((currentLatest, entry) =>
    entry.endMinutes > currentLatest.endMinutes ? entry : currentLatest,
  )

  if (latest.endMinutes <= minutes(22, 0)) return

  addFinding(findings, {
    code: "late-ending",
    severity: latest.endMinutes > minutes(23, 30) ? "critical" : "warning",
    title: "Day ends late",
    message: `${latest.activity.name} ends around ${formatClockTime(latest.endMinutes)}.`,
    recommendation:
      "Check transport availability and consider moving late activities earlier or closer to accommodation.",
    dayId: day.id,
    dayNumber: day.dayNumber,
    activityIds: [latest.activity.id],
  })
}

function addFinding(
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
  finding: Omit<ItineraryReviewFinding, "id">,
) {
  findings[finding.severity].push({
    ...finding,
    id: `${finding.dayId}:${finding.code}:${finding.activityIds?.join("-") ?? "day"}`,
  })
}

function hasCoordinates(lat: number | null, lng: number | null): boolean {
  return typeof lat === "number" && typeof lng === "number"
}

function parseClockTime(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return minutes(hour, minute)
}

function parseDurationText(value: string | null | undefined): number | null {
  if (!value) return null
  const hourMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/i)
  const minuteMatch = value.match(/(\d+)\s*(?:m|min|mins|minute|minutes)/i)
  const hours = hourMatch ? Number(hourMatch[1]) : 0
  const mins = minuteMatch ? Number(minuteMatch[1]) : 0
  const seconds = hours * 60 * 60 + mins * 60
  return seconds > 0 ? seconds : null
}

function hasMeal(activities: ReviewableActivity[], meal: "lunch" | "dinner"): boolean {
  const lowerMeal = meal.toLowerCase()
  return activities.some((activity) => {
    const haystack = [activity.name, activity.type, ...(activity.tags ?? [])]
      .join(" ")
      .toLowerCase()
    return haystack.includes(lowerMeal) || MEAL_TERMS.some((term) => haystack.includes(term))
  })
}

function minutes(hour: number, minute: number): number {
  return hour * 60 + minute
}

function formatClockTime(totalMinutes: number): string {
  const normalized = totalMinutes % (24 * 60)
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (hours === 0) return `${mins} minutes`
  if (mins === 0) return `${hours} hour${hours === 1 ? "" : "s"}`
  return `${hours} hour${hours === 1 ? "" : "s"} ${mins} minutes`
}
