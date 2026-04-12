import { z } from "zod"
import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"

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
    const model = google("gemini-3.1-flash-lite-preview")

    const result = await generateText({
      model,
      tools: {
        google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
      },
      output: Output.object({ schema: layoverTipsSchema }),
      stopWhen: stepCountIs(5),
      prompt: `You are a travel expert helping a traveler with a ${durationHours}-hour layover at ${airport} airport.

Time of arrival: ${timeOfDay || "unknown"}
Visa status: ${visaStatus || "unknown"}

Provide practical, specific advice:
- What they can realistically do in ${durationHours} hours (including immigration and transit time)
- Specific places, attractions, or food near the airport or reachable in the time
- Exact transit options (train, bus, taxi) with approximate costs and travel times
- When they should head back to the airport (accounting for security lines and immigration)

Be concise and practical. If the layover is short (under 3 hours), focus on in-airport options.
If visa status is "visa-required", focus only on airport transit zone options.`,
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

  const { used, limit } = await getAiUsage(session.user.id)
  if (used >= limit) {
    throw createError({
      statusCode: 429,
      message: `You've used ${used}/${limit} AI prompts this month.`,
    })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  const durationHours = Math.round(body.durationMinutes / 60)
  const timeOfDay = body.arrivalTime
    ? new Date(body.arrivalTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "unknown"

  await incrementAiUsage(session.user.id)

  return generateLayoverTips(body.airport, durationHours, body.visaStatus ?? "unknown", timeOfDay)
})
