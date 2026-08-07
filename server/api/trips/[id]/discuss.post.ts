import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { createEventStream } from "h3"
import type { AssistantModelMessage, UserModelMessage } from "ai"
import { z } from "zod"
import { db } from "../../../db"
import { expenses, itineraryDays, tripIdeas, trips } from "../../../db/schema"
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
import {
  creditsForSteps,
  discussStepCeiling,
  shouldStripTools,
  STEPS_PER_CREDIT,
  THINKING_CREDIT_MULTIPLIER,
} from "../../../utils/ai-credit-cost"
import { getTripWithRelations } from "../../../lib/trips"
import { buildTripContext } from "../../../lib/discuss-context"
import { getTripFlightsForUser } from "../../../lib/trip-flights"
import { aiProviderOptions, thinkingAvailable } from "../../../lib/ai-config"
import type { FlightPromptInput } from "../../../lib/ai"
import { stampGroup } from "../../../lib/proposal-targeting"
import type { Proposal } from "../../../lib/proposals"
import { mapChunk, toSseFrame } from "../../../lib/discuss-stream"
import { persistChatTurn } from "../../../lib/trip-chat"

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
  /**
   * Traveler opted into deeper reasoning for this turn. Untrusted — ANDed with
   * thinkingAvailable() below before it can affect the model or the price.
   */
  thinking: z.boolean().optional().default(false),
})

// buildTripContext lives in lib/discuss-context so it can be unit-tested
// (this endpoint module can't be imported outside Nitro).

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)

  const body = await readValidatedBody(event, discussBodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const trip = await db.query.trips.findFirst({ where: eq(trips.id, id) })
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  // Resolved once. Without a DeepSeek key getModel serves Gemini, which ignores
  // deepseek-namespaced provider options — charging the multiplier there would
  // bill 3x for a turn that never reasoned.
  const thinking = body.thinking && thinkingAvailable()
  const stepCeiling = discussStepCeiling(thinking)

  // Consume credit AFTER auth + body validation + access + existence checks,
  // so every throw above never needs a refund. Every throw below this point
  // is refunded exactly once by the try/catch wrap immediately below (or by
  // the agent generate call's own try/catch, further down).
  // The returned month is the reservation handle for the settle calls below: a
  // turn that consumes at 23:59:50 on the last day of the month can easily settle
  // after midnight, and recomputing "current month" there would scope the UPDATE
  // by a row that does not exist yet (issue #17).
  const usageMonth = await tryConsumeAiCredit(session.user.id)

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
      // Exactly 1, in BOTH modes. Unlike day generation, discuss charges the
      // remainder at settle time rather than up front — so a turn that reaches
      // this branch has only ever consumed the single tryConsumeAiCredit
      // credit. Refunding the multiplier here would mint the user free credits.
      await refundAiCredit(session.user.id, usageMonth, 1)
      return 0
    }
    // The ceiling must match the one the turn actually ran under, or a 40-step
    // thinking turn bills as though it had stopped at 30.
    const creditsUsed =
      creditsForSteps(steps, stepCeiling) * (thinking ? THINKING_CREDIT_MULTIPLIER : 1)
    await chargeExtraAiCredits(session.user.id, creditsUsed - 1, usageMonth)
    return creditsUsed
  }

  let tools: ReturnType<typeof createDiscussTools>
  let cleanMessages: { role: "user" | "assistant"; content: string }[]
  let dayId: string | null
  let transportMode: ReturnType<typeof normalizeTransportMode>
  let days: { id: string; dayNumber: number }[]
  let proposalCollector: Proposal[]
  // The user's own words for this turn, captured BEFORE the trip context is
  // prefixed onto the last user message below. Persisting the prefixed copy
  // would put a wall of generated itinerary state in the transcript and replay
  // a stale snapshot of it on every later turn.
  let latestUserContent = ""
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
    latestUserContent = cleanMessages.findLast((m) => m.role === "user")?.content ?? ""

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

    // Flight context — arrival/departure times bound what the agent may schedule
    // on those days. Degrades to "no flights" on failure rather than blocking.
    let flights: FlightPromptInput[] = []
    try {
      const flightRows = await getTripFlightsForUser({ tripId: id, userId: session.user.id })
      flights = flightRows.map((f) => ({
        departureAirport: f.departureAirport,
        arrivalAirport: f.arrivalAirport,
        departureTimeUtc: f.departureTime?.toISOString() ?? null,
        arrivalTimeUtc: f.arrivalTime?.toISOString() ?? null,
        departureTimeLocal: f.departureTimeLocal,
        arrivalTimeLocal: f.arrivalTimeLocal,
      }))
    } catch (e: unknown) {
      console.error("[discuss.post] Flight context unavailable, proceeding without:", e)
    }

    // Saved ideas — the traveler's curated wishlist, same context generation gets.
    // Degrades to empty on failure rather than blocking the turn.
    let savedIdeas: { name: string; type: string; description: string | null }[] = []
    try {
      savedIdeas = await db.query.tripIdeas.findMany({
        where: eq(tripIdeas.tripId, id),
        columns: { name: true, type: true, description: true },
      })
    } catch (e: unknown) {
      console.error("[discuss.post] Saved-ideas context unavailable, proceeding without:", e)
    }

    // Budget vs actual spend. The agent generates costEstimate values, so it
    // should be able to see what is actually left. Degrades to no budget line
    // on failure rather than blocking the turn.
    //
    // Summed over `amountInTripCurrency`, never `amount` (#47): `amount` is in
    // each expense's OWN currency, so adding a ¥3,200 lunch to a $20 taxi used
    // to report 3220 as the trip-currency spend. buildSpendLine labels this
    // figure with the trip's currency, and the projection column is the only
    // one that is actually in it. It is NOT NULL, so the COALESCE below is
    // only for the no-rows case.
    let spend: { budget: string | null; spent: number } | undefined
    try {
      const rows = await db
        .select({ total: sql<string>`COALESCE(SUM(${expenses.amountInTripCurrency}), 0)` })
        .from(expenses)
        .where(eq(expenses.tripId, id))
      spend = { budget: trip.budget ?? null, spent: parseFloat(rows[0]?.total ?? "0") || 0 }
    } catch (e: unknown) {
      console.error("[discuss.post] Spend context unavailable, proceeding without:", e)
    }

    // Inject trip context into the latest user message so the agent has it on every turn
    // without needing to call read_day / read_trip_summary.
    const tripContext = tripForCtx
      ? buildTripContext(
          tripForCtx,
          dayId,
          flights,
          { tripNotes: trip.tripNotes, savedIdeas },
          spend,
        )
      : ""
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
        userId: session.user.id,
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
  // `res 'close'` is edge-triggered and is NOT redelivered to a listener attached
  // after it fired. The client can disconnect during pre-flight (auth, body
  // validation, trip lookup, credit consume, tools setup), which all runs before
  // this point — a cold route made that a real 400ms window, and a turn whose
  // abort was missed runs to completion and bills the user for work they
  // dismissed. Checking the current state right after subscribing closes the gap:
  // already-closed => abort now; closes later => the listener fires.
  if (event.node.res.destroyed) {
    controller.abort()
  }

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

      const turnStartedAt = Date.now()
      const result = await discussAgent.stream(agentMessages, {
        toolsets: { discuss: tools },
        maxSteps: stepCeiling,
        providerOptions: aiProviderOptions(thinking),
        // The step budget used to be a guillotine: if the final step happened to be
        // a tool call, the loop stopped with response.text === "" and the user got
        // nothing but an apology. Two overrides fix that:
        //
        //  1. On the last permitted step (or once the wall-clock budget is spent —
        //     see shouldStripTools), strip the toolset. With no tools to call, the
        //     model has no choice but to spend that step writing a reply — so
        //     hitting the ceiling now degrades to a partial answer, never silence.
        //     The wall-clock arm is what keeps the raised thinking ceiling inside
        //     the 300s function limit — a timeout would kill the process before
        //     settleCredits runs.
        //  2. Otherwise, tell the model what it has left and what it costs. The
        //     system prompt asks it to wind down when "running low on steps", which
        //     it could never honour before — it has no view of its own step count.
        //     Returning a plain string is a valid `Instructions`; it re-states the
        //     agent's own prompt verbatim plus a runtime note, so nothing is lost.
        prepareStep: ({ stepNumber }) => {
          if (shouldStripTools(stepNumber, stepCeiling, Date.now() - turnStartedAt)) {
            return { activeTools: [] }
          }
          const remaining = stepCeiling - stepNumber
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
          await stream.push(toSseFrame({ event: "tool", data: { line: mapped.line } }))
        } else if (mapped.type === "thinking") {
          // Display-only. Deliberately NOT appended to streamedText: reasoning
          // is not the reply, must not be persisted, and must not make
          // `streamedAny` true — a turn that only thought delivered nothing and
          // is still refunded below.
          await stream.push(toSseFrame({ event: "thinking", data: { delta: mapped.delta } }))
        } else {
          streamedText += mapped.delta
          await stream.push(toSseFrame({ event: "text", data: { delta: mapped.delta } }))
        }
      }

      // The user got value iff they saw non-whitespace text or got proposals.
      // MUST use the same trim() as fallbackDiscussMessage's text.trim().length>0
      // check below — mapChunk only drops zero-length deltas, so a whitespace-only
      // delta (" ", "\n") streams through and would otherwise make this true while
      // fallbackDiscussMessage still calls it empty, charging the user for a turn
      // whose message says it wasn't counted.
      const streamedAny = streamedText.trim().length > 0 || proposalCollector.length > 0

      if (controller.signal.aborted) {
        // Metered even when cancelled: those steps were really spent. NOT
        // persisted, though — `streamedText` here is a sentence cut off
        // mid-word, and the client replays history into the next turn's
        // context, so storing it would poison the thread as well as show a
        // truncated reply forever. persistChatTurn enforces that itself; the
        // call is simply not made on this path.
        await settleCredits(streamedAny, stepsUsed)
        await stream.close()
        return
      }

      const final = fallbackDiscussMessage(streamedText, proposalCollector.length)
      // shouldRefund is exactly !streamedAny: fallbackDiscussMessage refunds iff
      // text.trim() is empty AND there are no proposals, which is the precise
      // negation of streamedAny's OR above (same trim(), same proposal check) —
      // not "in practice", provably so as long as both stay in sync.
      const creditsUsed = await settleCredits(streamedAny, stepsUsed)

      const groupedProposals = stampGroup(proposalCollector, randomUUID())

      // Assigned here rather than by the database, so `done` can carry it: the
      // client needs a name for this transcript row to record Apply/Dismiss
      // against, and the row itself is only written further down (deliberately
      // after `done` ships). Sent only when this turn will actually be
      // persisted — `streamedAny` is the same gate persistChatTurn applies —
      // so the client never holds an id for a row that does not exist.
      const assistantMessageId = randomUUID()

      await stream.push(
        toSseFrame({
          event: "done",
          data: {
            message: final.message,
            proposals: groupedProposals,
            toolCallSummary: toolLines,
            creditsUsed,
            ...(streamedAny ? { messageId: assistantMessageId } : {}),
          },
        }),
      )
      doneSent = true

      // Persist the completed turn. Deliberately AFTER settleCredits and after
      // `done` shipped: the credit accounting and the client's view of the turn
      // are both already final, so nothing here can move them. persistChatTurn
      // never throws for exactly that reason — a throw would fall into the
      // catch below, which would re-enter the (guarded, non-idempotent) settle
      // and could push an `error` frame for a turn the client saw succeed.
      //
      // Gated on `streamedAny` — the same predicate the refund branch uses. A
      // refunded turn's `final.message` is the "I ran out of room ... this
      // prompt wasn't counted" apology; recording it would put a refunded
      // non-answer in the transcript and replay it as model context forever.
      await persistChatTurn({
        tripId: id,
        userId: session.user.id,
        userContent: latestUserContent,
        // `final.message` rather than raw `streamedText`: it is exactly what the
        // client rendered (including the proposal-only lead-in), so history and
        // the live bubble can never disagree.
        assistantContent: streamedAny ? final.message : "",
        toolCallSummary: toolLines,
        proposals: groupedProposals,
        assistantMessageId,
        aborted: false,
      })

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
        // Same predicate as the clean-finish path above — must match
        // fallbackDiscussMessage's text.trim().length>0 check exactly.
        const streamedAny = streamedText.trim().length > 0 || proposalCollector.length > 0
        await settleCredits(streamedAny, stepsUsed)
        // `push` is a no-op once the writer has cleanly closed (h3's `_sendEvent`
        // early-returns in that case), so this guard exists to avoid pushing an
        // `error` event the client will never see — not because push is unsafe —
        // and to avoid misreporting a turn as failed after `done` already shipped
        // (doneSent).
        if (!controller.signal.aborted && !doneSent) {
          await stream.push(
            toSseFrame({
              event: "error",
              data: {
                message: "Sorry — I couldn't think that through right now. Try again in a moment.",
              },
            }),
          )
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
