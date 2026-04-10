import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { visitedCountries } from "../../db/schema";

const bodySchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  countryName: z.string().min(1).max(100),
  visitedAt: z.string().date().optional(),
  notes: z.string().max(500).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Check if already marked
  const existing = await db.query.visitedCountries.findFirst({
    where: and(
      eq(visitedCountries.userId, session.user.id),
      eq(visitedCountries.countryCode, body.countryCode)
    ),
  });

  if (existing) {
    throw createError({ statusCode: 409, message: "Country already marked as visited" });
  }

  const [result] = await db
    .insert(visitedCountries)
    .values({
      userId: session.user.id,
      countryCode: body.countryCode,
      countryName: body.countryName,
      visitedAt: body.visitedAt ?? null,
      notes: body.notes ?? null,
    })
    .returning();

  return result;
});
