import { and, eq, asc } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../../../../db"
import { activities, itineraryDays } from "../../../../../db/schema"
import { dayIdParamsSchema } from "../../../../../utils/schemas"
import { computeAndSaveSegments } from "../../../../../lib/segments"
import { getDistanceMatrix } from "../../../../../lib/google-maps"
import { consecutiveTravelTimes } from "../../../../../lib/travel-times"

const reorderSchema = z.object({
  activityIds: z.array(z.string().uuid()),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const { id, dayId } = await getValidatedRouterParams(event, dayIdParamsSchema.parse)
  const body = await readValidatedBody(event, reorderSchema.parse)

  await requireTripAccess(id, session.user.id, ["owner", "editor"])

  // Validate all activityIds belong to this day
  const dayActivities = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    columns: { id: true },
  })
  const dayActivityIds = new Set(dayActivities.map((a) => a.id))
  const invalidIds = body.activityIds.filter((aid) => !dayActivityIds.has(aid))
  if (invalidIds.length > 0) {
    throw createError({
      statusCode: 400,
      message: `Activity IDs do not belong to this day: ${invalidIds.join(", ")}`,
    })
  }

  // Update sort orders based on new array position
  await db.transaction(async (tx) => {
    for (let i = 0; i < body.activityIds.length; i++) {
      await tx
        .update(activities)
        .set({ sortOrder: i })
        .where(and(eq(activities.id, body.activityIds[i]!), eq(activities.itineraryDayId, dayId)))
    }
  })

  // Recompute schedule times based on new order
  const day = await db.query.itineraryDays.findFirst({
    where: and(eq(itineraryDays.id, dayId), eq(itineraryDays.tripId, id)),
    columns: { date: true },
  })
  const allDayActivities = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    orderBy: [asc(activities.sortOrder)],
  })

  if (day && allDayActivities.length >= 2) {
    // Get travel times for new order
    // Per-pair travel times — bills N-1 Distance Matrix elements instead of the
    // (N-1)² a full matrix would, and caches per pair. See consecutiveTravelTimes.
    const travelTimes = await consecutiveTravelTimes(allDayActivities, getDistanceMatrix)

    // Find earliest existing time as start
    let startHour = 9
    let startMinute = 0
    const times = allDayActivities
      .map((a) => a.suggestedTime)
      .filter((t): t is string => !!t)
      .map((t) => {
        const m = t.match(/^(\d{1,2}):(\d{2})/)
        return m ? parseInt(m[1]!) * 60 + parseInt(m[2]!) : null
      })
      .filter((m): m is number => m !== null)
    if (times.length > 0) {
      startHour = Math.floor(Math.min(...times) / 60)
      startMinute = Math.min(...times) % 60
    }

    // Compute non-overlapping schedule
    const schedule = computeSchedule({
      activities: allDayActivities.map((a) => ({
        id: a.id,
        name: a.name,
        estimatedDurationMinutes: a.estimatedDurationMinutes,
        lat: a.lat,
        lng: a.lng,
        openingMinutes: parseOpeningTime(a.openingHours, day.date),
      })),
      travelTimes,
      startHour,
      startMinute,
      bufferMinutes: 15,
    })

    // Apply computed times
    await db.transaction(async (tx) => {
      for (const s of schedule) {
        await tx
          .update(activities)
          .set({ sortOrder: s.sortOrder, suggestedTime: s.suggestedTime })
          .where(and(eq(activities.id, s.id), eq(activities.itineraryDayId, dayId)))
      }
    })
  }

  // Recompute travel segments
  await computeAndSaveSegments(dayId)

  // Log the action
  await logTripAction({
    tripId: id,
    userId: session.user.id,
    action: "activities_reordered",
    description: "Reordered activities and recalculated schedule",
  })

  return { success: true }
})
