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
    const model = google("gemini-3.1-flash-lite-preview")

    const result = await generateText({
      model,
      tools: { google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }) },
      output: Output.object({ schema: visaResultSchema }),
      stopWhen: stepCountIs(5),
      prompt: `You are a travel visa expert. Search the web for the CURRENT visa requirements for a traveler holding a ${passportCountryName} (${passportCountry}) passport who wants to visit ${destinationCountryName} (${destinationCountry}).

Search for the latest official visa policy. Provide accurate, up-to-date information about:
1. Whether a visa is required (visa_free, visa_on_arrival, e_visa, or visa_required)
2. Maximum allowed stay in days (for visa-free or visa on arrival)
3. What documents/requirements are needed
4. Typical processing time if a visa application is needed
5. Cost of the visa if applicable
6. Any additional notes (special conditions, transit visa needs, etc.)

Be specific and factual. If unsure about exact details, say so in the notes.`,
    })

    return result.output!
  },
  {
    maxAge: 60 * 60 * 24 * 30, // 30 days
    name: "visa-ai-details",
    getKey: (passportCountry: string, destinationCountry: string) =>
      `${passportCountry}:${destinationCountry}`,
  },
)
