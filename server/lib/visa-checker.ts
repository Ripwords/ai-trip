import { generateText, Output, stepCountIs } from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"

const visaResultSchema = z.object({
  visaStatus: z.enum(["visa_free", "visa_on_arrival", "e_visa", "visa_required"]),
  maxStayDays: z.number().int().positive().nullable(),
  requirements: z.string().describe("Summary of visa requirements, documents needed, etc."),
  processingTime: z.string().nullable().describe("Typical processing time"),
  cost: z.string().nullable().describe("Visa cost if applicable"),
  notes: z
    .string()
    .nullable()
    .describe("Additional relevant info like COVID rules, transit visa needs"),
})

export type VisaResult = z.infer<typeof visaResultSchema>

export const checkVisaRequirements = defineCachedFunction(
  async (
    passportCountry: string,
    destinationCountry: string,
    passportCountryName: string,
    destinationCountryName: string,
  ): Promise<VisaResult> => {
    const model = google("gemini-3.1-flash-lite")

    const result = await generateText({
      model,
      tools: { google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }) },
      output: Output.object({ schema: visaResultSchema }),
      stopWhen: stepCountIs(5),
      prompt: `You are a travel visa expert. Search the web for the latest official visa requirements for a traveler holding a ${passportCountryName} (${passportCountry}) passport who wants to visit ${destinationCountryName} (${destinationCountry}). Prefer the destination's official immigration/foreign-ministry source over third-party summaries.

Provide accurate information about:
1. Whether a visa is required (visa_free, visa_on_arrival, e_visa, or visa_required)
2. Maximum allowed stay in days (for visa-free or visa on arrival)
3. What documents/requirements are needed
4. Typical processing time if a visa application is needed
5. Cost of the visa if applicable
6. Any additional notes (special conditions, transit visa needs, etc.)

Be specific and factual. If you cannot find a confident answer, say so in the notes — do not guess. Visa policies change; always anchor on what you can find in the search results rather than what you remember.`,
    })

    return result.output!
  },
  {
    maxAge: 60 * 60 * 24 * 7, // 7 days — visa policy can shift; keep results reasonably fresh.
    name: "visa-ai-details",
    getKey: (passportCountry: string, destinationCountry: string) =>
      `${passportCountry}:${destinationCountry}`,
  },
)
