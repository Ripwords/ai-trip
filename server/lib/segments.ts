import { eq, asc } from "drizzle-orm"
import { db } from "../db"
import { activities, itineraryDays, travelSegments } from "../db/schema"
import { normalizeTransportMode, type TransportMode } from "../utils/transport"
import { getDistanceMatrix, getTimezone } from "./google-maps"
import {
  computeTransitDepartureTimestamp,
  findMissingMatrixIndices,
  pickSegmentData,
  type MatrixEntry,
} from "./segment-utils"

export async function computeAndSaveSegments(dayId: string, mode?: TransportMode): Promise<void> {
  let travelMode = normalizeTransportMode(mode)
  let dayDate: string | null = null
  if (!mode) {
    const day = await db.query.itineraryDays.findFirst({
      where: eq(itineraryDays.id, dayId),
      with: { trip: true },
    })
    travelMode = normalizeTransportMode(day?.trip.preferences?.transportMode)
    dayDate = day?.date ?? null
  } else {
    const day = await db.query.itineraryDays.findFirst({
      where: eq(itineraryDays.id, dayId),
      columns: { date: true },
    })
    dayDate = day?.date ?? null
  }

  // 1. Get activities for this day ordered by sortOrder
  const dayActivities = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    orderBy: [asc(activities.sortOrder)],
  })

  // 2. Filter to those with coordinates
  const geoActivities = dayActivities.filter((a) => a.lat != null && a.lng != null)

  // 3. Delete existing segments for this day
  await db.delete(travelSegments).where(eq(travelSegments.itineraryDayId, dayId))

  // 4. Need at least 2 activities with coords
  if (geoActivities.length < 2) return

  try {
    // 5. Build origins/destinations for consecutive pairs
    const origins = geoActivities.slice(0, -1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
    const destinations = geoActivities.slice(1).map((a) => ({ lat: a.lat!, lng: a.lng! }))
    const pairCount = origins.length

    // 6. For transit, resolve the destination's timezone so the activity
    //    time is interpreted as local wall-clock (e.g. "09:00 in NYC", not
    //    "09:00 UTC = 05:00 EDT"), then pass a future-bucketed departure
    //    time. The Time Zone API result is cached for 30 days per lat/lng.
    let departureTime: number | null = null
    if (travelMode === "transit" && dayDate) {
      const first = geoActivities[0]!
      let timeZoneId: string | null = null
      try {
        timeZoneId = await getTimezone(first.lat!, first.lng!)
      } catch (error) {
        console.error("Failed to resolve timezone, falling back to UTC:", error)
      }
      departureTime = computeTransitDepartureTimestamp(
        dayDate,
        first.suggestedTime ?? null,
        new Date(),
        timeZoneId,
      )
    }

    const primaryMatrix = (await getDistanceMatrix(
      origins,
      destinations,
      travelMode,
      departureTime,
    )) as MatrixEntry[][]

    // 7. If transit and some pairs have no result, batch a single walking
    //    fallback call so the user still sees an estimate.
    let fallbackMatrix: MatrixEntry[][] | null = null
    if (travelMode === "transit") {
      const missing = findMissingMatrixIndices(primaryMatrix, pairCount)
      if (missing.length > 0) {
        const fOrigins = missing.map((i) => origins[i]!)
        const fDestinations = missing.map((i) => destinations[i]!)
        try {
          const walkingMatrix = (await getDistanceMatrix(
            fOrigins,
            fDestinations,
            "walking",
          )) as MatrixEntry[][]
          // Re-expand into a sparse matrix aligned with the primary indices,
          // so pickSegmentData can look up by the original pair index.
          fallbackMatrix = Array.from({ length: pairCount }, () => [] as MatrixEntry[])
          missing.forEach((originalIndex, j) => {
            const row: MatrixEntry[] = []
            row[originalIndex] = walkingMatrix[j]?.[j] ?? { status: "ZERO_RESULTS" }
            fallbackMatrix![originalIndex] = row
          })
        } catch (error) {
          console.error("Failed to compute walking fallback:", error)
        }
      }
    }

    // 8. Build segment rows by merging primary + fallback
    const segmentValues = geoActivities.slice(0, -1).map((activity, i) => {
      const data = pickSegmentData(
        primaryMatrix[i]?.[i],
        fallbackMatrix?.[i]?.[i],
        travelMode,
        "walking",
      )
      return {
        itineraryDayId: dayId,
        fromActivityId: activity.id,
        toActivityId: geoActivities[i + 1]!.id,
        durationSeconds: data.durationSeconds,
        distanceMeters: data.distanceMeters,
        durationText: data.durationText,
        distanceText: data.distanceText,
        mode: data.mode,
      }
    })

    if (segmentValues.length > 0) {
      await db.insert(travelSegments).values(segmentValues)
    }
  } catch (error) {
    // Segments are non-blocking — log but don't throw
    console.error("Failed to compute travel segments:", error)
  }
}
