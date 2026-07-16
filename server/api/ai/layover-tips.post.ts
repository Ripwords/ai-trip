import { z } from "zod"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"
import { getModel } from "../../lib/ai-config"
import { sanitizePromptInput } from "../../utils/sanitize"

const bodySchema = z.object({
  airport: z.string().min(2).max(4).toUpperCase(),
  durationMinutes: z.number().int().positive(),
  visaStatus: z.string().nullable(),
  arrivalTime: z.string().nullable(),
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
  async (airport: string, durationHours: number, visaStatus: string, timeOfDay: string) => {
    const model = getModel("research")

    const requiresAirportOnly = visaStatus === "visa_required" || visaStatus === "visa-required"

    const result = await generateText({
      model,
      tools: {
        google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
      },
      output: Output.object({ schema: layoverTipsSchema }),
      stopWhen: stepCountIs(5),
      prompt: `You are a travel expert helping a traveler with a ${durationHours}-hour layover at ${airport} (IATA airport code).

Time of arrival: ${timeOfDay || "unknown"}
Visa status: ${visaStatus || "unknown"}

Provide practical, specific advice:
- What they can realistically do in ${durationHours} hours (including immigration and transit time)
- Specific places, attractions, or food near the airport or reachable in the time
- Exact transit options (train, bus, taxi) with approximate costs and travel times
- When they should head back to the airport (accounting for security lines and immigration)

Be concise and practical. If the layover is short (under 3 hours), focus on in-airport options.
${requiresAirportOnly ? "VISA RESTRICTION: the traveler needs a visa for this country and likely cannot exit immigration. Focus ONLY on airside / transit-zone options." : ""}`,
    })

    return result.output!
  },
  {
    maxAge: 60 * 60 * 24 * 30,
    name: "layover-tips",
    getKey: (airport: string, durationHours: number, visaStatus: string, _timeOfDay: string) =>
      `${airport}:${durationHours}:${visaStatus}`,
  },
)

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  // Atomically consume one AI credit (throws 429 if limit reached)
  await tryConsumeAiCredit(session.user.id)

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

  const durationHours = Math.round(body.durationMinutes / 60)
  const timeOfDay = body.arrivalTime
    ? new Date(body.arrivalTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "unknown"

  return generateLayoverTips(
    sanitizedAirport,
    durationHours,
    sanitizedVisaStatus ?? "unknown",
    timeOfDay,
  )
})
