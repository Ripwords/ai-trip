import { eq, asc } from "drizzle-orm"
import { db } from "../db"
import { activities, itineraryDays, travelSegments } from "../db/schema"
import { normalizeTransportMode, type TransportMode } from "../utils/transport"
import { getDistanceMatrix } from "./google-maps"
import { pickSegmentData, type MatrixEntry } from "./segment-utils"

export async function computeAndSaveSegments(dayId: string, mode?: TransportMode): Promise<void> {
  let travelMode = normalizeTransportMode(mode)
  if (!mode) {
    const day = await db.query.itineraryDays.findFirst({
      where: eq(itineraryDays.id, dayId),
      with: { trip: true },
    })
    travelMode = normalizeTransportMode(day?.trip.preferences?.transportMode)
  }

  // Always start clean — stale segments from a prior mode should not linger.
  await db.delete(travelSegments).where(eq(travelSegments.itineraryDayId, dayId))

  // Transit: legacy Distance Matrix transit data is unreliable (missing
  // routes for many real-world airport→city and inter-stop pairs), so we
  // don't compute durations for it. The UI links per-segment out to Google
  // Maps where users get authoritative transit directions.
  if (travelMode === "transit") return

  const dayActivities = await db.query.activities.findMany({
    where: eq(activities.itineraryDayId, dayId),
    orderBy: [asc(activities.sortOrder)],
  })
  const geoActivities = dayActivities.filter((a) => a.lat != null && a.lng != null)
  if (geoActivities.length < 2) return

  try {
    // One 1×1 request per consecutive pair — bills N-1 Distance Matrix elements
    // (not the (N-1)² a full origins×destinations grid would) and caches per
    // pair, so a pair that recurs across reorders is free. Runs in parallel.
    const pairs = geoActivities.slice(0, -1).map((from, i) => ({ from, to: geoActivities[i + 1]! }))
    const segmentValues = await Promise.all(
      pairs.map(async ({ from, to }) => {
        const matrix = (await getDistanceMatrix(
          [{ lat: from.lat!, lng: from.lng! }],
          [{ lat: to.lat!, lng: to.lng! }],
          travelMode,
        )) as MatrixEntry[][]
        const data = pickSegmentData(matrix[0]?.[0], undefined, travelMode, travelMode)
        return {
          itineraryDayId: dayId,
          fromActivityId: from.id,
          toActivityId: to.id,
          durationSeconds: data.durationSeconds,
          distanceMeters: data.distanceMeters,
          durationText: data.durationText,
          distanceText: data.distanceText,
          mode: data.mode,
        }
      }),
    )

    if (segmentValues.length > 0) {
      await db.insert(travelSegments).values(segmentValues)
    }
  } catch (error) {
    // Segments are non-blocking — log but don't throw
    console.error("Failed to compute travel segments:", error)
  }
}
