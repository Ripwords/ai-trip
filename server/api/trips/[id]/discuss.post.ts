import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../db"
import { itineraryDays, trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { normalizeTransportMode } from "../../../utils/transport"
import { detectInjection, sanitizePromptInput } from "../../../utils/sanitize"
import { createDiscussTools } from "../../../lib/ai-tools"
import { getExchangeRate } from "../../../utils/exchange-rate"
import { discussAgent } from "../../../lib/discuss-agent"
import { refundAiCredit } from "../../../utils/ai-limits"
import { getTripWithRelations } from "../../../lib/trips"
import { stampGroup } from "../../../lib/proposal-targeting"
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

type TripWithRelations = NonNullable<Awaited<ReturnType<typeof getTripWithRelations>>>

/** Neutralize bracket/id spoofing and control chars in stored free-text (B8). */
function escapeCtx(s: string): string {
  return s
    .replace(/[[\]]/g, "")
    .replace(/[\x00-\x1F]/g, " ")
    .slice(0, 120)
}

// Guard for pathological trips — not the common path.
const MAX_CONTEXT_ACTIVITY_LINES = 300

function buildTripContext(trip: TripWithRelations, focusDayId: string | null): string {
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

  const body = await readValidatedBody(event, discussBodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Consume credit AFTER auth + body validation + access + existence checks,
  // so every throw above never needs a refund and every throw below this
  // point (sanitize rejection, agent failure) refunds correctly.
  await tryConsumeAiCredit(session.user.id)

  // Reject if ANY message (incl. client-supplied assistant turns) contains an
  // injection attempt; normalize only user turns (assistant markdown is kept verbatim).
  if (body.messages.some((m) => detectInjection(m.content))) {
    await refundAiCredit(session.user.id)
    throw createError({ statusCode: 400, message: "Message contains disallowed content." })
  }
  const cleanMessages = body.messages.slice(-20).map((m) => ({
    role: m.role,
    content: m.role === "user" ? (sanitizePromptInput(m.content) ?? "") : m.content,
  }))
  if (cleanMessages.some((m) => m.role === "user" && !m.content)) {
    await refundAiCredit(session.user.id)
    throw createError({ statusCode: 400, message: "Message contains disallowed content." })
  }

  const transportMode = normalizeTransportMode(trip.preferences?.transportMode)

  // Defense-in-depth: validateActivityIds inside the AI tools already cross-checks
  // dayId, but block a cross-trip dayId at the boundary so it never reaches the
  // tool context or buildTripContext.
  let dayId: string | null = body.dayId ?? null
  if (dayId) {
    const day = await db.query.itineraryDays.findFirst({
      where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
      columns: { id: true },
    })
    if (!day) dayId = null
  }

  // Load the trip with days+activities once — reused for both the injected
  // trip context and the tools' day list, avoiding a redundant second fetch.
  const tripForCtx = await getTripWithRelations(id)
  const days = (tripForCtx?.days ?? []).map((d) => ({ id: d.id, dayNumber: d.dayNumber }))

  // Inject trip context into the latest user message so the agent has it on every turn
  // without needing to call read_day / read_trip_summary.
  const tripContext = tripForCtx ? buildTripContext(tripForCtx, dayId) : ""
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

  const usdRate = await getExchangeRate("USD", trip.currencyCode || "USD")

  const tools = createDiscussTools(
    {
      tripId: id,
      activeDayId: dayId ?? "",
      days,
      transportMode,
      currencyCode: trip.currencyCode || "USD",
      usdRate,
    },
    proposalCollector,
  )

  let assistantText = ""
  try {
    const response = await discussAgent.generate(cleanMessages, {
      toolsets: { discuss: tools },
      maxSteps: 10,
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

  // Stamp a shared groupId across proposals produced in this turn (no-op for a
  // single proposal) so the client can render multi-day fan-outs as one group.
  const groupedProposals = stampGroup(proposalCollector, randomUUID())

  // Diagnostic: what the agent proposed and which day each targets.
  console.log(
    `[discuss] activeDay=${dayId ?? "none"} proposals=[${groupedProposals
      .map((p) => `${p.kind}@${p.dayId}`)
      .join(", ")}]`,
  )

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
    proposals: groupedProposals,
    toolCallSummary,
  }
})
