import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { activities, itineraryDays } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../../lib/segments"
import { lockTripForStayWrite, reconcileTripStays } from "../../../../../lib/booking-sync"

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

/**
 * Optional so a client that hasn't been updated still restores activities.
 * When present, the day's accommodation is restored too — a set-accommodation
 * proposal offers Undo, and previously that silently left the accommodation in
 * place while reporting "Reverted."
 */
const accommodationSnapshotSchema = z.object({
  accommodationName: z.string().nullable(),
  accommodationPlaceId: z.string().nullable(),
  accommodationAddress: z.string().nullable(),
  accommodationLat: z.number().nullable(),
  accommodationLng: z.number().nullable(),
})

const restoreBodySchema = z.object({
  activities: z.array(activitySnapshotSchema).max(50),
  accommodation: accommodationSnapshotSchema.optional(),
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

  const insertValues = body.activities.map((a) => ({
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
  }))

  // Atomic delete + re-insert, plus the accommodation restore and the stay
  // reconciliation it implies. `db` is the neon-serverless driver (websocket
  // Pool) in every environment, which supports real transactions — the previous
  // `import.meta.dev` split called `db.batch`, which only exists on the
  // neon-*http* driver and would have thrown in production.
  //
  // The reconcile is not optional: undoing a `set-accommodation` proposal
  // rewrites `accommodation_*`, and those columns are a read-cache of `stays`.
  // Restoring them without reconciling leaves `stays` and the mirrored booking
  // holding the hotel the user just undid.
  await db.transaction(async (tx) => {
    // Before the day write, never after — see `lockTripForStayWrite`.
    if (body.accommodation) await lockTripForStayWrite(tx, id)

    await tx.delete(activities).where(eq(activities.itineraryDayId, dayId))
    if (insertValues.length > 0) {
      await tx.insert(activities).values(insertValues)
    }
    if (body.accommodation) {
      await tx.update(itineraryDays).set(body.accommodation).where(eq(itineraryDays.id, dayId))
      await reconcileTripStays(tx, id, session.user.id)
    }
  })

  // Recompute travel segments (accommodation anchors the day's route, so this
  // must run after the update above).
  await computeAndSaveSegments(dayId)

  // Audit log
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "ai_undo",
    description: `Undid AI changes, restored ${body.activities.length} activities${body.accommodation ? " and accommodation" : ""}`,
  })

  return { success: true, restored: body.activities.length }
})
