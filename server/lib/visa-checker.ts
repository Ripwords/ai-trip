import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { visaCache } from "../db/schema";
import { generateText, Output, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const visaResultSchema = z.object({
  visaStatus: z.enum(["visa_free", "visa_on_arrival", "e_visa", "visa_required"]),
  maxStayDays: z.number().int().positive().nullable(),
  requirements: z.string().describe("Summary of visa requirements, documents needed, etc."),
  processingTime: z.string().nullable().describe("Typical processing time"),
  cost: z.string().nullable().describe("Visa cost if applicable"),
  notes: z.string().nullable().describe("Additional relevant info like COVID rules, transit visa needs"),
});

export type VisaResult = z.infer<typeof visaResultSchema>;

export interface VisaCheckResult extends VisaResult {
  passportCountry: string;
  destinationCountry: string;
  cached: boolean;
  fetchedAt: Date;
}

const CACHE_TTL_DAYS = 30;

export async function checkVisaRequirements(
  passportCountry: string,
  destinationCountry: string,
  passportCountryName: string,
  destinationCountryName: string
): Promise<VisaCheckResult> {
  // Check cache first
  const cached = await db.query.visaCache.findFirst({
    where: and(
      eq(visaCache.passportCountry, passportCountry),
      eq(visaCache.destinationCountry, destinationCountry),
      gt(visaCache.expiresAt, new Date())
    ),
  });

  if (cached) {
    return {
      visaStatus: cached.visaStatus as VisaResult["visaStatus"],
      maxStayDays: cached.maxStayDays,
      requirements: cached.requirements ?? "",
      processingTime: cached.processingTime,
      cost: cached.cost,
      notes: cached.notes,
      passportCountry: cached.passportCountry,
      destinationCountry: cached.destinationCountry,
      cached: true,
      fetchedAt: cached.fetchedAt,
    };
  }

  // Use Gemini with Google Search grounding for up-to-date visa info
  let visaResult: VisaResult;
  try {
    const model = google("gemini-3.1-flash-lite-preview");

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
    });

    visaResult = result.output!;
  } catch (error) {
    throw createError({
      statusCode: 503,
      message: "Visa check is temporarily unavailable. Please try again later.",
    });
  }

  // Cache the result (upsert to handle race conditions)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

  await db
    .insert(visaCache)
    .values({
      passportCountry,
      destinationCountry,
      visaStatus: visaResult.visaStatus,
      maxStayDays: visaResult.maxStayDays,
      requirements: visaResult.requirements,
      processingTime: visaResult.processingTime,
      cost: visaResult.cost,
      notes: visaResult.notes,
      source: "ai_web_search",
      fetchedAt: new Date(),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [visaCache.passportCountry, visaCache.destinationCountry],
      set: {
        visaStatus: visaResult.visaStatus,
        maxStayDays: visaResult.maxStayDays,
        requirements: visaResult.requirements,
        processingTime: visaResult.processingTime,
        cost: visaResult.cost,
        notes: visaResult.notes,
        fetchedAt: new Date(),
        expiresAt,
      },
    });

  return {
    ...visaResult,
    passportCountry,
    destinationCountry,
    cached: false,
    fetchedAt: new Date(),
  };
}
