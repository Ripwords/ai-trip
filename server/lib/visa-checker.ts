import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { visaCache } from "../db/schema";
import { getModel } from "./ai-config";
import { generateObject } from "ai";
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
  destinationCountry: string
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

  // Fetch from AI
  const model = getModel();
  const result = await generateObject({
    model,
    schema: visaResultSchema,
    prompt: `You are a travel visa expert. Research the current visa requirements for a traveler holding a ${passportCountry} passport who wants to visit ${destinationCountry}.

Provide accurate, up-to-date information about:
1. Whether a visa is required (visa_free, visa_on_arrival, e_visa, or visa_required)
2. Maximum allowed stay in days (for visa-free or visa on arrival)
3. What documents/requirements are needed
4. Typical processing time if a visa application is needed
5. Cost of the visa if applicable
6. Any additional notes (special conditions, transit visa needs, etc.)

Be specific and factual. If unsure about exact details, say so in the notes.`,
  });

  const visaResult = result.object;

  // Cache the result
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
    .onConflictDoNothing();

  return {
    ...visaResult,
    passportCountry,
    destinationCountry,
    cached: false,
    fetchedAt: new Date(),
  };
}
