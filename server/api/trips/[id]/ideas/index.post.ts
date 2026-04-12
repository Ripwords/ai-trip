import { eq, sql } from "drizzle-orm"
import { db } from "../../../../db"
import { tripIdeas } from "../../../../db/schema"
import { uuidParamsSchema, createIdeaSchema } from "../../../../utils/schemas"

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, createIdeaSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Check per-trip idea limit
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tripIdeas)
    .where(eq(tripIdeas.tripId, id))
  if (count >= 100) {
    throw createError({
      statusCode: 400,
      message: "Maximum number of ideas per trip reached (100)",
    })
  }

  const { rating, ...restBody } = body
  const [idea] = await db
    .insert(tripIdeas)
    .values({
      ...restBody,
      tripId: id,
      rating: rating != null ? String(rating) : undefined,
    })
    .returning()

  return idea
})
