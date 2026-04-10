import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { activities, itineraryDays } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../../lib/segments"

const activitySnapshotSchema = z.object({
  name: z.string(),
  placeId: z.string().nullable(),
  type: z.string(),
  description: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  address: z.string().nullable(),
  rating: z.string().nullable(),
  priceLevel: z.number().nullable(),
  openingHours: z.array(z.string()).nullable(),
  photos: z.array(z.string()).nullable(),
  suggestedTime: z.string().nullable(),
  estimatedDurationMinutes: z.number().nullable(),
  costEstimate: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  sortOrder: z.number(),
  notes: z.string().nullable(),
  actualCost: z.string().nullable(),
})

const restoreBodySchema = z.object({
  activities: z.array(activitySnapshotSchema),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const body = await readValidatedBody(event, restoreBodySchema.parse)

  // Verify trip access (owner or editor can undo)
  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Verify day belongs to this trip
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
  })
  if (!day) {
    throw createError({ statusCode: 404, message: "Day not found" })
  }

  // Atomic delete + re-insert
  await db.transaction(async (tx) => {
    await tx.delete(activities).where(eq(activities.itineraryDayId, dayId))

    if (body.activities.length > 0) {
      await tx.insert(activities).values(
        body.activities.map((a) => ({
          itineraryDayId: dayId,
          name: a.name,
          placeId: a.placeId,
          type: a.type,
          description: a.description,
          lat: a.lat,
          lng: a.lng,
          address: a.address,
          rating: a.rating,
          priceLevel: a.priceLevel,
          openingHours: a.openingHours ?? [],
          photos: a.photos ?? [],
          suggestedTime: a.suggestedTime,
          estimatedDurationMinutes: a.estimatedDurationMinutes,
          costEstimate: a.costEstimate,
          tags: a.tags ?? [],
          sortOrder: a.sortOrder,
          notes: a.notes,
          actualCost: a.actualCost,
        })),
      )
    }
  })

  // Recompute travel segments
  await computeAndSaveSegments(dayId)

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_undo",
    description: `Undid AI changes, restored ${body.activities.length} activities`,
  })

  return { success: true, restored: body.activities.length }
})
