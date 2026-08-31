import "zod/compile"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { itineraryDays } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"

const notesBodySchema = z.object({
  notes: z.string().max(5000).nullable(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const body = await readValidatedBody(event, notesBodySchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
  })
  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  await db
    .update(itineraryDays)
    .set({
      notes: body.notes || null,
    })
    .where(eq(itineraryDays.id, dayId))

  return { success: true }
})
