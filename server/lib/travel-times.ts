import type { DistanceMatrixEntry, LatLng } from "./google-maps"
import type { TransportMode } from "../utils/transport"

export interface TravelTime {
  fromId: string
  toId: string
  durationMinutes: number
}

type GeoActivity = { id: string; lat: number | null; lng: number | null }

/** Injected so this stays unit-testable without hitting the Maps API. */
export type MatrixFetcher = (
  origins: LatLng[],
  destinations: LatLng[],
  mode?: TransportMode,
) => Promise<DistanceMatrixEntry[][]>

/**
 * Travel time for each CONSECUTIVE pair of geo-located activities.
 *
 * The previous form asked Distance Matrix for the full (N-1)×(N-1) origins×
 * destinations grid and then read only the diagonal — so it BILLED (N-1)²
 * elements to use N-1, and its cache key (the whole origin/destination lists)
 * changed on every reorder, so it never hit. Requesting each consecutive pair
 * as a 1×1 matrix bills exactly N-1 elements and caches per pair, so a pair
 * that recurs across reorders is free. Calls run in parallel; a failed pair
 * degrades to "no travel time" rather than dropping the whole day.
 */
export async function consecutiveTravelTimes(
  activities: GeoActivity[],
  fetchMatrix: MatrixFetcher,
  mode: TransportMode = "driving",
): Promise<TravelTime[]> {
  const geo = activities.filter((a) => a.lat != null && a.lng != null)
  if (geo.length < 2) return []

  const pairs = geo.slice(0, -1).map((from, i) => ({ from, to: geo[i + 1]! }))
  const results = await Promise.all(
    pairs.map(async ({ from, to }): Promise<TravelTime | null> => {
      try {
        const matrix = await fetchMatrix(
          [{ lat: from.lat!, lng: from.lng! }],
          [{ lat: to.lat!, lng: to.lng! }],
          mode,
        )
        const seconds = matrix[0]?.[0]?.duration?.value
        if (seconds == null) return null
        return { fromId: from.id, toId: to.id, durationMinutes: Math.ceil(seconds / 60) }
      } catch {
        return null
      }
    }),
  )
  return results.filter((r): r is TravelTime => r != null)
}
