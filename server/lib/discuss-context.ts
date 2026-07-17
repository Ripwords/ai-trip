import type { TripPreferences } from "../db/schema/trips"
import {
  buildFlightsCtx,
  buildSavedIdeasCtx,
  buildTripNotesCtx,
  type FlightPromptInput,
} from "./ai"

/** The slice of a trip the discuss context needs — structurally satisfied by getTripWithRelations. */
export interface DiscussContextTrip {
  destination: string
  startDate: string
  endDate: string
  currencyCode: string | null
  preferences: TripPreferences | null
  days: {
    id: string
    dayNumber: number
    date: string
    accommodationName: string | null
    activities: {
      id: string
      sortOrder: number
      suggestedTime: string | null
      estimatedDurationMinutes: number | null
      name: string
      type: string
    }[]
  }[]
}

/** Neutralize bracket/id spoofing and control chars in stored free-text (B8). */
function escapeCtx(s: string): string {
  return s
    .replace(/[[\]]/g, "")
    .replace(/[\x00-\x1F]/g, " ")
    .slice(0, 120)
}

// Guard for pathological trips — not the common path.
const MAX_CONTEXT_ACTIVITY_LINES = 300

export interface DiscussContextExtras {
  tripNotes?: string | null
  savedIdeas?: { name: string; type: string; description: string | null }[]
}

export function buildTripContext(
  trip: DiscussContextTrip,
  focusDayId: string | null,
  flights?: FlightPromptInput[],
  extras?: DiscussContextExtras,
): string {
  const lines: string[] = []
  lines.push(
    `Destination: ${escapeCtx(trip.destination)}. Dates: ${trip.startDate} → ${trip.endDate}. Trip currency: ${trip.currencyCode || "USD"} (all cost estimates must be in this currency — do NOT convert to USD).`,
  )

  const prefs = trip.preferences
  if (prefs) {
    const parts: string[] = []
    if (prefs.pace) parts.push(`pace=${prefs.pace}`)
    if (prefs.budget) parts.push(`budget=${prefs.budget}`)
    if (prefs.interests?.length) parts.push(`interests=${prefs.interests.join(",")}`)
    if (prefs.travelStyle?.length) parts.push(`style=${prefs.travelStyle.join(",")}`)
    if (prefs.transportMode) parts.push(`transport=${prefs.transportMode}`)
    if (parts.length > 0) lines.push(`Preferences: ${parts.join(", ")}.`)
  }

  // Every day, with [day:…] and [act:…] ids, and the OPEN day marked — the
  // agent's system prompt promises this shape so propose* tools can target
  // any day (or several) by id without an extra readDay/readTripSummary call.
  const sortedDays = trip.days.toSorted((a, b) => a.dayNumber - b.dayNumber)

  let activityLines = 0
  let trimmed = false
  for (const d of sortedDays) {
    if (trimmed) break
    const open = d.id === focusDayId ? " · OPEN" : ""
    lines.push(
      `--- Day ${d.dayNumber} (${d.date}) [day:${d.id}]${d.accommodationName ? ` · staying at ${escapeCtx(d.accommodationName)}` : ""}${open} ---`,
    )
    const acts = d.activities.toSorted((a, b) => a.sortOrder - b.sortOrder)
    if (acts.length === 0) {
      lines.push("  (no activities yet)")
    } else {
      for (const a of acts) {
        if (activityLines >= MAX_CONTEXT_ACTIVITY_LINES) {
          trimmed = true
          break
        }
        const time = a.suggestedTime ?? "??:??"
        const dur = a.estimatedDurationMinutes ? ` (${a.estimatedDurationMinutes}min)` : ""
        lines.push(`  • [act:${a.id}] ${time} ${escapeCtx(a.name)} — ${a.type}${dur}`)
        activityLines++
      }
    }
  }
  if (trimmed) {
    lines.push("  (…additional days trimmed)")
  }

  // Flights shape what fits on arrival/departure days — same context and hard
  // rules the generation handlers get (see buildFlightsCtx).
  const flightsCtx = buildFlightsCtx(flights)
  if (flightsCtx) lines.push(flightsCtx.trimStart())

  // Trip notes + saved ideas: the same (sanitized) context the generation
  // handlers and the outline get — the agent should discuss around the
  // traveler's stated constraints and curated wishlist.
  const notesCtx = buildTripNotesCtx(extras?.tripNotes)
  if (notesCtx) lines.push(notesCtx.trimStart())
  const ideasCtx = buildSavedIdeasCtx(extras?.savedIdeas)
  if (ideasCtx) lines.push(ideasCtx.trimStart())

  return lines.join("\n")
}
