import { z } from "zod"
import {
  reviewItinerary,
  type ItineraryReviewFinding,
  type ItineraryReviewOptions,
  type ItineraryReviewResult,
  type ItineraryReviewSeverity,
  type ReviewableTrip,
} from "./itinerary-review"
import { proposalSchema } from "./proposals"
import { createTripTools } from "./ai-tools"
import { getModel } from "./ai-config"
import type { TransportMode } from "../utils/transport"

// ── Judgment schema ───────────────────────────────────────────────────

const judgmentCodeSchema = z.enum([
  "pace-mismatch",
  "backtracking-route",
  "closed-on-date",
  "interest-mismatch",
  "energy-imbalance",
])

const judgmentFindingSchema = z.object({
  code: judgmentCodeSchema,
  severity: z.enum(["critical", "warning", "suggestion"]),
  title: z.string(),
  message: z.string(),
  recommendation: z.string(),
  dayId: z.string(),
  dayNumber: z.number().int(),
  activityIds: z.array(z.string()).optional(),
  proposal: proposalSchema.optional(),
})

const judgmentOutputSchema = z.object({
  findings: z.array(judgmentFindingSchema),
})

// ── mergeFindings ─────────────────────────────────────────────────────

/**
 * Merge deterministic and AI judgment findings.
 *
 * Rules:
 * - Dedupes by `dayId:code`. The deterministic finding wins (its `id` is kept).
 * - If the judgment finding for the same key carries a `proposal` and the
 *   deterministic one does not, the proposal is attached to the deterministic finding.
 * - Judgment findings with unique codes are appended after all deterministic ones.
 */
export function mergeFindings(
  deterministic: ItineraryReviewFinding[],
  judgment: ItineraryReviewFinding[],
): ItineraryReviewFinding[] {
  const key = (f: ItineraryReviewFinding) => `${f.dayId}:${f.code}`
  const detByKey = new Map(deterministic.map((f) => [key(f), f]))

  const result: ItineraryReviewFinding[] = []

  for (const f of deterministic) {
    const matchingJudgment = judgment.find((j) => key(j) === key(f))
    if (matchingJudgment?.proposal && !f.proposal) {
      result.push({ ...f, proposal: matchingJudgment.proposal })
    } else {
      result.push(f)
    }
  }

  for (const j of judgment) {
    if (!detByKey.has(key(j))) result.push(j)
  }

  return result
}

// ── helpers ───────────────────────────────────────────────────────────

function groupBySeverity(
  findings: ItineraryReviewFinding[],
): Record<ItineraryReviewSeverity, ItineraryReviewFinding[]> {
  const out: Record<ItineraryReviewSeverity, ItineraryReviewFinding[]> = {
    critical: [],
    warning: [],
    suggestion: [],
  }
  for (const f of findings) out[f.severity].push(f)
  return out
}

// ── reviewItineraryWithJudgment ───────────────────────────────────────

/**
 * Layered itinerary review: runs the fast deterministic checker first, then
 * adds an AI judgment pass that can catch pace mismatches, backtracking,
 * closed venues, interest conflicts, and energy imbalances.
 *
 * The AI pass uses a two-call pattern:
 *   1. `agent.generate` with trip tools attached so it can look up distances,
 *      place details, and day contents.
 *   2. `generateObject` against the agent's text output to produce structured
 *      `ItineraryReviewFinding[]`.
 *
 * If the AI pass fails for any reason the deterministic result is returned
 * unchanged (graceful degradation).
 */
export async function reviewItineraryWithJudgment(
  trip: ReviewableTrip,
  options: ItineraryReviewOptions,
  ctx: { tripId: string; dayId: string; transportMode: TransportMode },
): Promise<ItineraryReviewResult> {
  const deterministic = reviewItinerary(trip, options)
  const deterministicFlat: ItineraryReviewFinding[] = [
    ...deterministic.findings.critical,
    ...deterministic.findings.warning,
    ...deterministic.findings.suggestion,
  ]

  let judgmentFlat: ItineraryReviewFinding[] = []

  try {
    const { Mastra } = await import("@mastra/core/mastra")
    const { Agent } = await import("@mastra/core/agent")
    const { generateObject } = await import("ai")

    const tools = createTripTools(ctx)

    const reviewAgent = new Agent({
      id: "reviewer",
      name: "Itinerary Reviewer",
      instructions: `You are an expert travel itinerary reviewer. You identify issues that automated checkers cannot catch: pace mismatches, geographic backtracking, venues closed on the scheduled day, interests mismatches, and energy imbalances. Always use the available tools to verify claims before flagging issues.`,
      model: getModel("research"),
      tools: {
        searchPlaces: tools.searchPlaces,
        getPlaceDetails: tools.getPlaceDetails,
        getDistance: tools.getDistance,
        readDay: tools.readDay,
        readTripSummary: tools.readTripSummary,
      },
    })

    const mastra = new Mastra({ agents: { reviewer: reviewAgent } })
    const agent = mastra.getAgent("reviewer")

    const alreadyFlagged = deterministicFlat.map((f) => ({ dayId: f.dayId, code: f.code }))

    const agentResponse = await agent.generate(
      `Review the itinerary for JUDGMENT issues a deterministic checker cannot catch:
- pace-mismatch: too many/few stops vs the traveler's stated pace preference
- backtracking-route: day zig-zags geographically (use getDistance to verify)
- closed-on-date: a venue is closed on the scheduled day-of-week (use getPlaceDetails)
- interest-mismatch: stops conflict with stated interests
- energy-imbalance: packed morning + packed evening with no recovery break

Deterministic findings already flagged (do NOT repeat these codes for the same day):
${JSON.stringify(alreadyFlagged)}

When a finding has an obvious fix (e.g., missing meal, closed venue), attach a Proposal in 'proposal'. Use searchPlaces to ground-truth a real restaurant for meal additions.

Scope: ${options.scope}${options.dayId ? ` (dayId=${options.dayId})` : ""}.
Trip destination: ${trip.destination ?? "unknown"}.

Respond with a JSON object matching this shape (your entire response should be only this JSON):
{
  "findings": [
    {
      "code": "<one of: pace-mismatch | backtracking-route | closed-on-date | interest-mismatch | energy-imbalance>",
      "severity": "<critical | warning | suggestion>",
      "title": "<short title>",
      "message": "<description>",
      "recommendation": "<fix recommendation>",
      "dayId": "<dayId>",
      "dayNumber": <number>,
      "activityIds": ["<optional>"],
      "proposal": null
    }
  ]
}`,
      { toolsets: { review: tools }, maxSteps: 4 },
    )

    // Strip markdown fences if present before parsing
    const rawText = agentResponse.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")

    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      // If the agent returned non-JSON prose, skip judgment silently
      parsed = { findings: [] }
    }

    const validated = judgmentOutputSchema.safeParse(parsed)
    if (validated.success) {
      // Add synthetic id to each judgment finding
      judgmentFlat = validated.data.findings.map((f) => ({
        ...f,
        id: `${f.dayId}:${f.code}:${f.activityIds?.join("-") ?? "judgment"}`,
      })) as ItineraryReviewFinding[]
    }
  } catch (e) {
    console.error(
      "[review-ai] judgment generation failed, returning deterministic only:",
      e,
    )
  }

  const merged = mergeFindings(deterministicFlat, judgmentFlat)
  const grouped = groupBySeverity(merged)

  return {
    scope: options.scope,
    dayId: options.scope === "day" ? options.dayId : undefined,
    findings: grouped,
    summary: {
      checkedDays: deterministic.summary.checkedDays,
      checkedActivities: deterministic.summary.checkedActivities,
      totalFindings: merged.length,
      critical: grouped.critical.length,
      warning: grouped.warning.length,
      suggestion: grouped.suggestion.length,
    },
  }
}
