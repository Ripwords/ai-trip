import { farFromAnchor } from "../utils/geo"

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

export interface ReviewableFlight {
  departureAirport: string | null
  arrivalAirport: string | null
  /** Local wall-clock strings "YYYY-MM-DD HH:MM±TZ" when known. */
  departureTimeLocal: string | null
  arrivalTimeLocal: string | null
}

export interface ReviewableTrip {
  id: string
  destination?: string
  days: ReviewableDay[]
  /** Optional — callers without user context omit it and skip flight findings. */
  flights?: ReviewableFlight[]
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
    | "insufficient-transfer-time"
    | "long-travel-segment"
    | "missing-lunch"
    | "missing-dinner"
    | "late-ending"
    | "missing-activity-coordinates"
    | "activity-before-flight-arrival"
    | "activity-after-flight-departure"
    | "evening-activity-far-from-stay"
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
// Mirror buildFlightsCtx's hard rules: ~90min to clear an arrival airport,
// leave for the airport 3h before departure.
const ARRIVAL_BUFFER_MINUTES = 90
const DEPARTURE_CUTOFF_MINUTES = 180
// An activity starting at/after this hour should be near where the traveler
// sleeps that night — otherwise it forces a long out-and-back after dark.
const EVENING_START_MINUTES = 18 * 60
const FAR_FROM_STAY_KM = 12
// Transfer-time conflict: ignore a couple minutes of slack; warn on a real
// overrun; escalate to critical when you'd arrive well after the next start.
const TRANSFER_GRACE_MINUTES = 3
const TRANSFER_CRITICAL_MINUTES = 20

/** Where the traveler sleeps after `day`: the day's own accommodation, or the most recent prior day's. */
function effectiveAccommodation(
  day: ReviewableDay,
  allDays: ReviewableDay[],
): { name: string | null; lat: number; lng: number } | null {
  if (day.accommodationLat != null && day.accommodationLng != null) {
    return { name: day.accommodationName, lat: day.accommodationLat, lng: day.accommodationLng }
  }
  const prior = allDays
    .filter(
      (d) =>
        d.dayNumber < day.dayNumber && d.accommodationLat != null && d.accommodationLng != null,
    )
    .toSorted((a, b) => b.dayNumber - a.dayNumber)[0]
  if (!prior || prior.accommodationLat == null || prior.accommodationLng == null) return null
  return { name: prior.accommodationName, lat: prior.accommodationLat, lng: prior.accommodationLng }
}

function addAccommodationDistanceFindings(
  day: ReviewableDay,
  allDays: ReviewableDay[],
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
) {
  const stay = effectiveAccommodation(day, allDays)
  if (!stay) return
  const evening = day.activities.filter((a) => {
    const t = parseClockTime(a.suggestedTime)
    return t != null && t >= EVENING_START_MINUTES
  })
  const far = farFromAnchor(
    evening.map((a) => ({ lat: a.lat, lng: a.lng })),
    { lat: stay.lat, lng: stay.lng },
    FAR_FROM_STAY_KM,
  )
  if (far.length === 0) return
  const flagged = far.map((f) => ({ activity: evening[f.index]!, km: Math.round(f.distanceKm) }))
  addFinding(findings, {
    code: "evening-activity-far-from-stay",
    severity: "warning",
    title: "Evening plans are far from tonight's stay",
    message: `${flagged
      .map((f) => `${f.activity.name} (~${f.km}km)`)
      .join(", ")} ${flagged.length === 1 ? "is" : "are"} a long trip from ${
      stay.name ?? "your accommodation"
    }, where you sleep tonight — you'll drive out and back after dark.`,
    recommendation:
      "Move these to a day based nearer them, or swap for an evening option closer to your accommodation.",
    dayId: day.id,
    dayNumber: day.dayNumber,
    activityIds: flagged.map((f) => f.activity.id),
  })
}

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
    addFlightFindings(day, trip.flights ?? [], findings, {
      firstTripDate: allDays[0]?.date,
      lastTripDate: allDays[allDays.length - 1]?.date,
    })
    addAccommodationDistanceFindings(day, allDays, findings)
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

/** Parse "YYYY-MM-DD HH:MM±TZ" into minutes-of-day, only when the local date matches `date`. */
function parseLocalFlightMinutes(local: string | null, date: string): number | null {
  if (!local) return null
  const match = local.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/)
  if (!match || match[1] !== date) return null
  return Number(match[2]) * 60 + Number(match[3])
}

function addFlightFindings(
  day: ReviewableDay,
  flights: ReviewableFlight[],
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
  tripBounds: { firstTripDate?: string; lastTripDate?: string },
) {
  for (const flight of flights) {
    const arrivalMinutes = parseLocalFlightMinutes(flight.arrivalTimeLocal, day.date)
    const departureMinutes = parseLocalFlightMinutes(flight.departureTimeLocal, day.date)

    // A flight departing AND arriving on this same date is directional: on the
    // trip's first day it's the inbound leg (only the arrival bound applies —
    // its departure happened at the origin city); on the last day it's the
    // outbound leg (only the departure cutoff applies).
    const sameDay = arrivalMinutes != null && departureMinutes != null
    const skipDeparture = sameDay && day.date === tripBounds.firstTripDate
    const skipArrival = sameDay && day.date === tripBounds.lastTripDate

    if (arrivalMinutes != null && !skipArrival) {
      const readyMinutes = arrivalMinutes + ARRIVAL_BUFFER_MINUTES
      const tooEarly = day.activities.filter((a) => {
        const start = parseClockTime(a.suggestedTime)
        return start != null && start < readyMinutes
      })
      if (tooEarly.length > 0) {
        addFinding(findings, {
          code: "activity-before-flight-arrival",
          severity: "critical",
          title: "Activities start before the flight lands",
          message: `${tooEarly.map((a) => a.name).join(", ")} start${tooEarly.length === 1 ? "s" : ""} before the ${flight.departureAirport ?? "?"} → ${flight.arrivalAirport ?? "?"} flight clears the airport (~${formatClockTime(readyMinutes)} after landing, immigration, and transfer).`,
          recommendation:
            "Move these activities after the arrival window, or to another day — nothing fits before the traveler leaves the airport.",
          dayId: day.id,
          dayNumber: day.dayNumber,
          activityIds: tooEarly.map((a) => a.id),
        })
      }
    }

    if (departureMinutes != null && !skipDeparture) {
      const cutoffMinutes = departureMinutes - DEPARTURE_CUTOFF_MINUTES
      const tooLate = day.activities.filter((a) => {
        const start = parseClockTime(a.suggestedTime)
        if (start == null) return false
        const end = start + (a.estimatedDurationMinutes ?? 0)
        return end > cutoffMinutes
      })
      if (tooLate.length > 0) {
        addFinding(findings, {
          code: "activity-after-flight-departure",
          severity: "critical",
          title: "Activities run past the airport cutoff",
          message: `${tooLate.map((a) => a.name).join(", ")} end${tooLate.length === 1 ? "s" : ""} after ${formatClockTime(cutoffMinutes)}, when the traveler must leave for the ${flight.departureAirport ?? "?"} → ${flight.arrivalAirport ?? "?"} departure.`,
          recommendation:
            "End the day by the airport cutoff — move or shorten these activities, or shift them to an earlier day.",
          dayId: day.id,
          dayNumber: day.dayNumber,
          activityIds: tooLate.map((a) => a.id),
        })
      }
    }
  }
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
  addTransferTimeFindings(day, timedActivities, findings)
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

// A raw time overlap is caught by addOverlapFindings. This catches the subtler
// case the LLM misses: two stops that DON'T overlap on the clock, but the drive
// between them is longer than the gap — so the traveler arrives at the next
// stop after its scheduled start. estimatedDurationMinutes is venue-time only;
// the real transfer time lives in the day's travel segments.
function addTransferTimeFindings(
  day: ReviewableDay,
  timedActivities: TimedActivity[],
  findings: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]>,
) {
  const sorted = timedActivities.toSorted((a, b) => a.startMinutes - b.startMinutes)
  const segmentByFrom = new Map(day.travelSegments.map((s) => [s.fromActivityId, s]))

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!
    const next = sorted[i + 1]!
    // Raw overlap is addOverlapFindings' job — only judge the no-overlap gap.
    if (current.endMinutes > next.startMinutes) continue

    const segment = segmentByFrom.get(current.activity.id)
    if (!segment) continue
    if (segment.toActivityId != null && segment.toActivityId !== next.activity.id) continue

    const travelSeconds = segment.durationSeconds ?? parseDurationText(segment.durationText)
    if (travelSeconds == null) continue

    const arrivalMinutes = current.endMinutes + Math.ceil(travelSeconds / 60)
    const overrunMinutes = arrivalMinutes - next.startMinutes
    // Grace for rounding / a couple minutes' slack; escalate a large overrun.
    if (overrunMinutes < TRANSFER_GRACE_MINUTES) continue

    addFinding(findings, {
      code: "insufficient-transfer-time",
      severity: overrunMinutes > TRANSFER_CRITICAL_MINUTES ? "critical" : "warning",
      title: "Not enough time to travel between stops",
      message: `${current.activity.name} ends at ${formatClockTime(
        current.endMinutes,
      )} and the trip to ${next.activity.name} takes about ${formatDuration(
        travelSeconds,
      )}, so you'd arrive around ${formatClockTime(arrivalMinutes)} — after its ${formatClockTime(
        next.startMinutes,
      )} start.`,
      recommendation:
        "Push the later start time back, shorten the earlier stop, or reorder so the drive fits.",
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
