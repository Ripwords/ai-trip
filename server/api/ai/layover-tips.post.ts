import "zod/compile"
import { z } from "zod"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"
import { getModel } from "../../lib/ai-config"
import { sanitizePromptInput } from "../../utils/sanitize"
import { refundAiCredit } from "../../utils/ai-limits"
import { layoverTipsCacheKey, timeOfDayBucket } from "../../lib/ai-cache"
import { buildLayoverTipsPrompt, layoverTipsBodySchema } from "../../lib/layover-tips-prompt"

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
  async (
    airport: string,
    durationMinutes: number | null,
    visaStatus: string,
    timeOfDay: string,
  ) => {
    const model = getModel("research")

    const result = await generateText({
      model,
      tools: {
        google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
      },
      output: Output.object({ schema: layoverTipsSchema }),
      stopWhen: stepCountIs(5),
      prompt: buildLayoverTipsPrompt({ airport, durationMinutes, visaStatus, timeOfDay }),
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

  const body = await readValidatedBody(event, layoverTipsBodySchema.parse)

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
  // Null means unknown, and the prompt says so (B20).
  const durationMinutes = body.durationMinutes ?? null
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
