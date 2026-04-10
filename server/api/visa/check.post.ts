import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userProfiles } from "../../db/schema";
import { checkVisaRequirements } from "../../lib/visa-checker";

const bodySchema = z.object({
  destinationCountry: z.string().length(2).toUpperCase(),
  passportCountry: z.string().length(2).toUpperCase().optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Resolve passport country: explicit param > user profile
  let passportCountry = body.passportCountry;

  if (!passportCountry) {
    const profile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, session.user.id),
    });
    passportCountry = profile?.nationality ?? null;
  }

  if (!passportCountry) {
    throw createError({
      statusCode: 400,
      message: "No passport nationality set. Please set your nationality in settings or provide passportCountry.",
    });
  }

  if (passportCountry === body.destinationCountry) {
    return {
      visaStatus: "visa_free" as const,
      maxStayDays: null,
      requirements: "This is your home country. No visa required.",
      processingTime: null,
      cost: null,
      notes: null,
      passportCountry,
      destinationCountry: body.destinationCountry,
      cached: false,
      fetchedAt: new Date(),
    };
  }

  const result = await checkVisaRequirements(passportCountry, body.destinationCountry);
  return result;
});
