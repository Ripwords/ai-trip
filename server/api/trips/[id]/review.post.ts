import { z } from "zod"
import { reviewItinerary } from "../../../lib/itinerary-review"
import { getTripWithRelations } from "../../../lib/trips"
import { uuidParamsSchema } from "../../../utils/schemas"

const reviewRequestSchema = z
  .object({
    scope: z.enum(["day", "trip"]),
    dayId: z.string().uuid().optional(),
  })
  .refine((value) => value.scope === "trip" || value.dayId, {
    message: "dayId is required when scope is day",
    path: ["dayId"],
  })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id } = await getValidatedRouterParams(event, uuidParamsSchema.parse)
  const body = await readValidatedBody(event, reviewRequestSchema.parse)

  await requireTripAccess(id, session.user.id)

  const trip = await getTripWithRelations(id)
  if (!trip) {
    throw createError({ statusCode: 404, message: "Trip not found" })
  }

  try {
    return reviewItinerary(trip, body)
  } catch (error) {
    if (error instanceof Error && error.message === "Day not found") {
      throw createError({ statusCode: 404, message: "Day not found" })
    }
    throw error
  }
})
