import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { activities, activityVotes } from "../../../../../db/schema"
import { activityIdParamsSchema } from "../../../../../utils/schemas"

const voteBodySchema = z.object({
  vote: z.enum(["up", "down"]),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, activityId } = await getValidatedRouterParams(event, activityIdParamsSchema.parse)
  const body = await readValidatedBody(event, voteBodySchema.parse)

  await requireTripAccess(id, session.user.id)

  // Verify activity belongs to trip
  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
    with: { day: true },
  })
  if (!activity || activity.day.tripId !== id) {
    throw createError({ statusCode: 404, message: "Activity not found" })
  }

  // Upsert vote
  const existing = await db.query.activityVotes.findFirst({
    where: and(eq(activityVotes.activityId, activityId), eq(activityVotes.userId, session.user.id)),
  })

  if (existing) {
    if (existing.vote === body.vote) {
      // Same vote — toggle off (delete)
      await db.delete(activityVotes).where(eq(activityVotes.id, existing.id))
      return { vote: null }
    }
    // Different vote — update
    await db.update(activityVotes).set({ vote: body.vote }).where(eq(activityVotes.id, existing.id))
    return { vote: body.vote }
  }

  // New vote
  await db.insert(activityVotes).values({
    activityId,
    userId: session.user.id,
    vote: body.vote,
  })
  return { vote: body.vote }
})
