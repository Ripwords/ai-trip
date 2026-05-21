import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { normalizeTransportMode } from "../../../utils/transport"
import { sanitizePromptInput } from "../../../utils/sanitize"
import { createDiscussTools } from "../../../lib/ai-tools"
import { discussAgent } from "../../../lib/discuss-agent"
import { refundAiCredit } from "../../../utils/ai-limits"
import { getTripWithRelations } from "../../../lib/trips"
import type { Proposal } from "../../../lib/proposals"

const discussBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
  dayId: z.string().uuid().optional(),
})

interface ToolSummaryEntry {
  toolId: string
  args: Record<string, unknown>
}

async function buildTripContext(tripId: string, focusDayId: string | null): Promise<string> {
  const trip = await getTripWithRelations(tripId)
  if (!trip) return ""

  const lines: string[] = []
  lines.push(
    `Destination: ${trip.destination}. Dates: ${trip.startDate} → ${trip.endDate}. Trip currency: ${trip.currencyCode || "USD"} (all cost estimates must be in this currency — do NOT convert to USD).`,
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

  const sortedDays = trip.days.toSorted((a, b) => a.dayNumber - b.dayNumber)
  const focusDay = focusDayId ? sortedDays.find((d) => d.id === focusDayId) : null

  if (focusDay) {
    const head = `--- Active day: Day ${focusDay.dayNumber} (${focusDay.date})${focusDay.accommodationName ? ` · staying at ${focusDay.accommodationName}` : ""} ---`
    lines.push(head)
    if (focusDay.activities.length === 0) {
      lines.push("  (no activities scheduled yet)")
    } else {
      const activitiesSorted = focusDay.activities.toSorted((a, b) => a.sortOrder - b.sortOrder)
      let hasTransport = false
      for (const a of activitiesSorted) {
        const time = a.suggestedTime ?? "??:??"
        const dur = a.estimatedDurationMinutes ? ` (${a.estimatedDurationMinutes}min)` : ""
        const waypointTag = a.type === "transport" ? " [waypoint, kept for map reference]" : ""
        if (a.type === "transport") hasTransport = true
        lines.push(`  • [${a.id}] ${time} ${a.name} — ${a.type}${dur}${waypointTag}`)
      }
      if (hasTransport) {
        lines.push(
          "  (note: transport-type entries are intentional waypoints, not destinations — do not suggest removing them)",
        )
      }
    }
  }

  // Brief trip-wide outline (other days, names only)
  const otherDays = sortedDays.filter((d) => d.id !== focusDayId)
  if (otherDays.length > 0) {
    lines.push("Other days (overview):")
    for (const d of otherDays) {
      const names = d.activities
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .map((a) => a.name)
        .slice(0, 8)
      const tail = d.activities.length > 8 ? ` +${d.activities.length - 8} more` : ""
      lines.push(`  Day ${d.dayNumber} (${d.date}): ${names.join(", ") || "empty"}${tail}`)
    }
  }

  return lines.join("\n")
}

function describeToolCall(entry: ToolSummaryEntry): string {
  const args = entry.args
  switch (entry.toolId) {
    case "readDay":
      return "checked the day's schedule"
    case "readTripSummary":
      return "reviewed your trip"
    case "searchPlaces":
      return `searched Google Maps for '${String(args.query ?? "").slice(0, 80)}'`
    case "getPlaceDetails":
      return "looked up venue details"
    case "getDistance":
      return "checked travel time between two stops"
    case "webSearch":
      return `searched the web for '${String(args.query ?? "").slice(0, 80)}'`
    case "runReview":
      return "ran a structural check on the itinerary"
    default:
      return entry.toolId
  }
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  // Consume credit BEFORE running the agent. Refund on agent error.
  await tryConsumeAiCredit(session.user.id)

  const body = await readValidatedBody(event, discussBodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!trip) {
    await refundAiCredit(session.user.id)
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Sanitize each message's content (user inputs only — assistant replies are trusted).
  const cleanMessages = body.messages.slice(-20).map((m) => ({
    role: m.role,
    content: m.role === "user" ? (sanitizePromptInput(m.content) ?? "") : m.content,
  }))
  if (cleanMessages.some((m) => m.role === "user" && !m.content)) {
    await refundAiCredit(session.user.id)
    throw createError({
      statusCode: 400,
      message: "Message contains disallowed content.",
    })
  }

  const transportMode = normalizeTransportMode(trip.preferences?.transportMode)
  const dayId = body.dayId ?? null

  // Inject trip context into the latest user message so the agent has it on every turn
  // without needing to call read_day / read_trip_summary.
  const tripContext = await buildTripContext(id, dayId)
  if (tripContext) {
    const lastUserIdx = cleanMessages.findLastIndex((m) => m.role === "user")
    if (lastUserIdx >= 0) {
      const original = cleanMessages[lastUserIdx]!
      cleanMessages[lastUserIdx] = {
        role: original.role,
        content: `[Trip context — current state of the user's plan]\n${tripContext}\n\n[User]\n${original.content}`,
      }
    }
  }

  const proposalCollector: Proposal[] = []
  const toolCalls: ToolSummaryEntry[] = []

  const tools = createDiscussTools(
    {
      tripId: id,
      dayId: dayId ?? "",
      transportMode,
      currencyCode: trip.currencyCode || "USD",
    },
    proposalCollector,
  )

  let assistantText = ""
  try {
    const response = await discussAgent.generate(cleanMessages, {
      toolsets: { discuss: tools },
      maxSteps: 6,
      onStepFinish: (step) => {
        for (const c of step.toolCalls) {
          toolCalls.push({
            toolId: c.payload.toolName,
            args: (c.payload.args as Record<string, unknown>) ?? {},
          })
        }
      },
    })
    assistantText = response.text
  } catch (e) {
    console.error("[discuss] agent failed:", e)
    await refundAiCredit(session.user.id)
    return {
      success: true,
      message: "Sorry — I couldn't think that through right now. Try again in a moment.",
      proposals: [],
      toolCallSummary: [],
    }
  }

  const toolCallSummary = toolCalls
    .filter((c) => !c.toolId.startsWith("propose"))
    .map(describeToolCall)

  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_discuss",
    description: `AI discuss: ${assistantText.slice(0, 200)}`,
    metadata: {
      proposalCount: proposalCollector.length,
      toolCalls: toolCalls.map((c) => c.toolId),
    },
  })

  return {
    success: true,
    message: assistantText,
    proposals: proposalCollector,
    toolCallSummary,
  }
})
