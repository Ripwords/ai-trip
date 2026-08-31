import "zod/compile"
import { eq, and, isNull } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db"
import { trips, visitedCountries } from "../../db/schema"

const bodySchema = z.object({
  countryCode: z.string().length(2).toUpperCase(),
  countryName: z.string().min(1).max(100),
  visitType: z.enum(["visited", "layover", "want_to_visit"]).default("visited"),
  visitedAt: z.string().date().optional(),
  notes: z.string().max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Check if already marked
  const existing = await db.query.visitedCountries.findFirst({
    where: and(
      eq(visitedCountries.userId, session.user.id),
      eq(visitedCountries.countryCode, body.countryCode),
    ),
  })

  // Upsert — allows changing visit type for an already-marked country
  const [result] = await db
    .insert(visitedCountries)
    .values({
      userId: session.user.id,
      countryCode: body.countryCode,
      countryName: body.countryName,
      visitType: body.visitType,
      visitedAt: body.visitedAt ?? null,
      notes: body.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [visitedCountries.userId, visitedCountries.countryCode],
      set: { visitType: body.visitType },
    })
    .returning()

  if (body.visitType !== "visited") {
    await db
      .update(trips)
      .set({ exploreSuppressedAt: new Date() })
      .where(
        and(
          eq(trips.userId, session.user.id),
          eq(trips.countryCode, body.countryCode),
          isNull(trips.exploreSuppressedAt),
        ),
      )
  }

  return result
})
