import "zod/compile"
import { z } from "zod"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"
import { getModel } from "../../lib/ai-config"
import { sanitizePromptInput } from "../../utils/sanitize"
import { refundAiCredit } from "../../utils/ai-limits"
import { layoverTipsCacheKey, timeOfDayBucket, formatLayoverDuration } from "../../lib/ai-cache"

const bodySchema = z.object({
  airport: z.string().min(2).max(4).toUpperCase(),
  durationMinutes: z.number().int().positive(),
  visaStatus: z.string().nullable(),
  /**
   * Wall clock at the layover airport, e.g. "2026-08-16 03:00+08:00".
   *
   * NOT the UTC `flights.arrivalTime`: that column is `timestamp with timezone`
   * and serialises with `Z`, and a UTC instant cannot say what the airport clock
   * read. Optional so a stale client bundle degrades to an "unknown" bucket
   * rather than a wrong one (issue #15).
   */
  arrivalTimeLocal: z.string().nullable().optional(),
})

const layoverTipsSchema = z.object({
  recommendation: z.string().describe("One-sentence summary of what to do during the layover"),
  suggestions: z
    .array(z.string())
    .describe("2-4 specific things to do, places to visit, or food to try"),
  transitInfo: z.string().describe("How to get from the airport to the city/attractions and back"),
  returnBy: z
    .string()
    .describe("When to head back to the airport, accounting for security/immigration"),
})

const generateLayoverTips = defineCachedFunction(
  async (airport: string, durationMinutes: number, visaStatus: string, timeOfDay: string) => {
    const model = getModel("research")

    const requiresAirportOnly = visaStatus === "visa_required" || visaStatus === "visa-required"
    const duration = formatLayoverDuration(durationMinutes)
    const isShort = durationMinutes < 180

    const result = await generateText({
      model,
      tools: {
        google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
      },
      output: Output.object({ schema: layoverTipsSchema }),
      stopWhen: stepCountIs(5),
      prompt: `You are a travel expert helping a traveler with a ${duration} layover at ${airport} (IATA airport code).

Time of arrival (local): ${timeOfDay}
Visa status: ${visaStatus || "unknown"}

Provide practical, specific advice:
- What they can realistically do in ${duration.replace(/-/g, " ")} (including immigration and transit time)
- Specific places, attractions, or food near the airport or reachable in the time
- Exact transit options (train, bus, taxi) with approximate costs and travel times
- When they should head back to the airport (accounting for security lines and immigration)

Be concise and practical.${isShort ? " This layover is under 3 hours — focus on in-airport options only." : ""}
${requiresAirportOnly ? "VISA RESTRICTION: the traveler needs a visa for this country and likely cannot exit immigration. Focus ONLY on airside / transit-zone options." : ""}`,
    })

    // Throw rather than assert with `!`: an undefined output would otherwise be
    // returned as-is AND cached for the full 30-day maxAge, and the handler's
    // refund path would never run because nothing threw.
    if (!result.output) throw new Error("layover tips: model returned no structured output")
    return result.output
  },
  {
    maxAge: 60 * 60 * 24 * 30,
    name: "layover-tips",
    // Never cache a failed generation (see the FX/research cache lesson).
    validate: (entry: { value?: unknown }) =>
      entry.value != null && typeof entry.value === "object",
    getKey: layoverTipsCacheKey,
  },
)

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  // Sanitize user-controlled fields before embedding in AI prompt
  const sanitizedAirport = sanitizePromptInput(body.airport)
  const sanitizedVisaStatus = body.visaStatus ? sanitizePromptInput(body.visaStatus) : "unknown"
  if (!sanitizedAirport || (body.visaStatus && !sanitizedVisaStatus)) {
    throw createError({
      statusCode: 400,
      message:
        "Your input contains disallowed content. Please provide valid travel information only.",
    })
  }

  // Minutes all the way through. `Math.round` turned a 179-minute layover into
  // "3 hours" and lost the "under 3 hours" instruction; `Math.floor` then asked
  // the model what to do "in 0 hours" on a 45-minute connection (issue #15).
  const durationMinutes = body.durationMinutes
  // Coarse bucket, used for BOTH the prompt and the cache key so the cached answer
  // always corresponds to the key it is stored under.
  const timeOfDay = timeOfDayBucket(body.arrivalTimeLocal)

  // Consume AFTER body validation + sanitization, so a 400 never costs a
  // credit — same ordering the day-AI and discuss endpoints use, and for the
  // same reason: every throw above this line needs no refund.
  const usageMonth = await tryConsumeAiCredit(session.user.id)

  try {
    return await generateLayoverTips(
      sanitizedAirport,
      durationMinutes,
      sanitizedVisaStatus ?? "unknown",
      timeOfDay,
    )
  } catch (e: unknown) {
    // The model produced nothing usable — the traveler keeps their credit.
    console.error("[layover-tips] generation failed:", e)
    await refundAiCredit(session.user.id, usageMonth)
    throw createError({
      statusCode: 502,
      message: "Couldn't generate layover tips right now. Please try again.",
    })
  }
})
