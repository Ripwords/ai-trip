import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { createEventStream } from "h3"
import type { AssistantModelMessage, UserModelMessage } from "ai"
import { z } from "zod"
import { db } from "../../../db"
import { itineraryDays, trips } from "../../../db/schema"
import { uuidParamsSchema } from "../../../utils/schemas"
import { normalizeTransportMode } from "../../../utils/transport"
import { detectInjection, sanitizePromptInput } from "../../../utils/sanitize"
import { createDiscussTools } from "../../../lib/ai-tools"
import { getExchangeRate } from "../../../utils/exchange-rate"
import {
  DISCUSS_SYSTEM_PROMPT,
  discussAgent,
  fallbackDiscussMessage,
} from "../../../lib/discuss-agent"
import { chargeExtraAiCredits, refundAiCredit } from "../../../utils/ai-limits"
import { creditsForSteps, MAX_DISCUSS_STEPS, STEPS_PER_CREDIT } from "../../../utils/ai-credit-cost"
import { getTripWithRelations } from "../../../lib/trips"
import { stampGroup } from "../../../lib/proposal-targeting"
import type { Proposal } from "../../../lib/proposals"
import { mapChunk } from "../../../lib/discuss-stream"

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
  // so every throw above never needs a refund. Every throw below this point
  // is refunded exactly once by the try/catch wrap immediately below (or by
  // the agent generate call's own try/catch, further down).
  await tryConsumeAiCredit(session.user.id)

  // A discuss turn is step-metered: 1 credit up front, the remainder charged at
  // the end by creditsForSteps(stepsUsed). BOTH primitives are non-idempotent —
  // refundAiCredit is GREATEST(count-1,0) (double refund = free credit) and
  // chargeExtraAiCredits is promptCount + extra (double charge = double bill).
  // Streaming adds settle paths (pre-stream throw, mid-stream throw, client
  // disconnect, clean finish), so every one of them goes through this guard.
  let settled = false
  /** Settle the turn exactly once: refund if the user got nothing, else meter. */
  async function settleCredits(streamedAny: boolean, steps: number): Promise<number> {
    if (settled) return 0
    // Flip the flag BEFORE the DB awaits below, on purpose: if refundAiCredit
    // or chargeExtraAiCredits throws, the turn is left unsettled rather than
    // retried — a throwing primitive here is fail-open (never wrongly
    // charges), whereas setting the flag after the await would risk a second
    // settle call racing in and double-settling against these non-idempotent
    // SQL updates. An unsettled turn on primitive failure is the accepted
    // trade-off.
    settled = true
    if (!streamedAny) {
      await refundAiCredit(session.user.id)
      return 0
    }
    const creditsUsed = creditsForSteps(steps)
    await chargeExtraAiCredits(session.user.id, creditsUsed - 1)
    return creditsUsed
  }

  let tools: ReturnType<typeof createDiscussTools>
  let cleanMessages: { role: "user" | "assistant"; content: string }[]
  let dayId: string | null
  let transportMode: ReturnType<typeof normalizeTransportMode>
  let days: { id: string; dayNumber: number }[]
  let proposalCollector: Proposal[]
  try {
    // Reject if ANY message (incl. client-supplied assistant turns) contains an
    // injection attempt; normalize only user turns (assistant markdown is kept verbatim).
    if (body.messages.some((m) => detectInjection(m.content))) {
      throw createError({ statusCode: 400, message: "Message contains disallowed content." })
    }
    cleanMessages = body.messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.role === "user" ? (sanitizePromptInput(m.content) ?? "") : m.content,
    }))
    if (cleanMessages.some((m) => m.role === "user" && !m.content)) {
      throw createError({ statusCode: 400, message: "Message contains disallowed content." })
    }

    transportMode = normalizeTransportMode(trip.preferences?.transportMode)

    // Defense-in-depth: validateActivityIds inside the AI tools already cross-checks
    // dayId, but block a cross-trip dayId at the boundary so it never reaches the
    // tool context or buildTripContext.
    dayId = body.dayId ?? null
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
    days = (tripForCtx?.days ?? []).map((d) => ({ id: d.id, dayNumber: d.dayNumber }))

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

    proposalCollector = []

    const usdRate = await getExchangeRate("USD", trip.currencyCode || "USD")

    tools = createDiscussTools(
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
  } catch (e) {
    // Anything that throws after the credit was consumed and before the agent
    // ran refunds exactly once here. The agent call below has its own try/catch.
    await settleCredits(false, 0)
    throw e
  }

  const controller = new AbortController()
  const stream = createEventStream(event)

  // Client disconnect (tab closed, Cancel pressed) aborts the agent so a
  // cancelled turn stops burning model tokens — and, because the turn is
  // step-metered, stops running up the user's bill. Before this, cancelling
  // only aborted the client fetch; the server ran to completion and charged.
  //
  // h3's EventStream.onClosed() hooks req 'close' (h3/dist/index.mjs:1546), but Node
  // fires res 'close' on a client disconnect — readValidatedBody already consumed the
  // request body, so req ends cleanly and never emits 'close' when the socket dies.
  // Verified on bare h3 + Node 24: res 'close' fires at disconnect (+1.6s), req 'close'
  // never does. Without this, Cancel is cosmetic: the agent runs to completion and the
  // user is billed for a turn they dismissed.
  //
  // res 'close' also fires on our OWN clean-finish stream.close() below, but by then
  // controller.signal.aborted has already been checked (see the loop-end branch) and
  // settleCredits has already run — settleCredits is guarded by `settled`, so a late
  // abort() here can neither flip a finished turn into the abort branch nor double-settle.
  event.node.res.on("close", () => {
    controller.abort()
  })

  let streamedText = ""
  let stepsUsed = 0
  const toolLines: string[] = []
  // Set right after the `done` push succeeds, so the catch below never ships
  // an `error` event for a turn the client already saw finish successfully
  // (e.g. if logTripAction throws after `done` already shipped).
  let doneSent = false

  // Pushed in the background; the handler returns stream.send() immediately.
  void (async () => {
    try {
      // Mastra's MessageListInput is a union of discriminated message shapes
      // (role: 'user' XOR role: 'assistant', not role: 'user' | 'assistant').
      // cleanMessages unifies `role` into one literal-union field across every
      // element, which the type checker can't match to that union even though
      // each element is individually a valid CoreMessage — so re-narrow it here
      // per element instead of widening the whole array to `any`/a cast.
      const agentMessages: (UserModelMessage | AssistantModelMessage)[] = cleanMessages.map(
        (m): UserModelMessage | AssistantModelMessage =>
          m.role === "user"
            ? { role: "user", content: m.content }
            : { role: "assistant", content: m.content },
      )

      const result = await discussAgent.stream(agentMessages, {
        toolsets: { discuss: tools },
        maxSteps: MAX_DISCUSS_STEPS,
        // The step budget used to be a guillotine: if the final step happened to be
        // a tool call, the loop stopped with response.text === "" and the user got
        // nothing but an apology. Two overrides fix that:
        //
        //  1. On the last permitted step, strip the toolset. With no tools to call,
        //     the model has no choice but to spend that step writing a reply — so
        //     hitting the ceiling now degrades to a partial answer, never silence.
        //  2. Otherwise, tell the model what it has left and what it costs. The
        //     system prompt asks it to wind down when "running low on steps", which
        //     it could never honour before — it has no view of its own step count.
        //     Returning a plain string is a valid `Instructions`; it re-states the
        //     agent's own prompt verbatim plus a runtime note, so nothing is lost.
        prepareStep: ({ stepNumber }) => {
          const remaining = MAX_DISCUSS_STEPS - stepNumber
          if (remaining <= 1) return { activeTools: [] }
          return {
            instructions: `${DISCUSS_SYSTEM_PROMPT}

[Runtime] You have ${remaining} tool-call steps left this turn. Every ${STEPS_PER_CREDIT} steps costs the user one AI credit from a small monthly allowance, so treat searching as spending their money: research only what you will actually propose. On your last step the tools are removed and you must write your reply, so wind down before then.`,
          }
        },
        abortSignal: controller.signal,
      })

      for await (const chunk of result.fullStream) {
        // Mastra enqueues provider/model failures as an ordinary `error` chunk and lets
        // the stream close cleanly — it never calls controller.error(). Without this,
        // the loop would exit normally and a failed turn would take the clean-finish
        // path: shipping `done` with the step-budget apology, and (worse) metering a
        // turn that died mid-answer.
        if (chunk.type === "error") {
          const err = chunk.payload.error
          throw err instanceof Error
            ? err
            : new Error(typeof err === "string" ? err : JSON.stringify(err ?? "stream error"))
        }
        if (chunk.type === "step-finish") stepsUsed++
        const mapped = mapChunk(chunk)
        if (!mapped) continue
        if (mapped.type === "tool") {
          toolLines.push(mapped.line)
          await stream.push({ event: "tool", data: JSON.stringify({ line: mapped.line }) })
        } else {
          streamedText += mapped.delta
          await stream.push({ event: "text", data: JSON.stringify({ delta: mapped.delta }) })
        }
      }

      // The user got value iff they saw text or got proposals. Existing
      // fallbackDiscussMessage rule, extended to streaming.
      const streamedAny = streamedText.length > 0 || proposalCollector.length > 0

      if (controller.signal.aborted) {
        // Metered even when cancelled: those steps were really spent.
        await settleCredits(streamedAny, stepsUsed)
        await stream.close()
        return
      }

      const final = fallbackDiscussMessage(streamedText, proposalCollector.length)
      // shouldRefund === !streamedAny in practice; pass streamedAny so the
      // settle rule has ONE definition.
      const creditsUsed = await settleCredits(streamedAny, stepsUsed)

      const groupedProposals = stampGroup(proposalCollector, randomUUID())

      await stream.push({
        event: "done",
        data: JSON.stringify({
          message: final.message,
          proposals: groupedProposals,
          toolCallSummary: toolLines,
          creditsUsed,
        }),
      })
      doneSent = true

      console.log(
        `[discuss] activeDay=${dayId ?? "none"} proposals=[${groupedProposals
          .map((p) => `${p.kind}@${p.dayId}`)
          .join(", ")}]`,
      )

      await logTripAction({
        tripId: id,
        userId: session.user.id,
        action: "ai_discuss",
        description: `AI discuss: ${final.message.slice(0, 200)}`,
        metadata: {
          proposalCount: proposalCollector.length,
          toolCalls: toolLines.length,
          stepsUsed,
          creditsUsed,
        },
      })

      await stream.close()
    } catch (e) {
      console.error("[discuss] agent failed:", e)
      // Settling and the error-push are wrapped so a throw from either one still
      // reaches `finally` and closes the stream — otherwise the exception would
      // escape this `void (async () => {...})()` as an unhandled rejection and
      // strand the client's SSE connection open forever with no `error` event
      // and no close.
      try {
        const streamedAny = streamedText.length > 0 || proposalCollector.length > 0
        await settleCredits(streamedAny, stepsUsed)
        // `push` is a no-op once the writer has cleanly closed (h3's `_sendEvent`
        // early-returns in that case), so this guard exists to avoid pushing an
        // `error` event the client will never see — not because push is unsafe —
        // and to avoid misreporting a turn as failed after `done` already shipped
        // (doneSent).
        if (!controller.signal.aborted && !doneSent) {
          await stream.push({
            event: "error",
            data: JSON.stringify({
              message: "Sorry — I couldn't think that through right now. Try again in a moment.",
            }),
          })
        }
      } catch (settleOrPushError) {
        // No client left to tell; log so a settle-primitive failure is diagnosable.
        console.error("[discuss] settle/error-push failed:", settleOrPushError)
      } finally {
        await stream.close()
      }
    }
  })()

  return stream.send()
})
