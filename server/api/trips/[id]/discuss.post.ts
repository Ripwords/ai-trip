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

  const proposalCollector: Proposal[] = []
  const toolCalls: ToolSummaryEntry[] = []

  const tools = createDiscussTools(
    {
      tripId: id,
      dayId: dayId ?? "",
      transportMode,
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
