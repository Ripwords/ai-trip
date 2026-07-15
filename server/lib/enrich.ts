import type { AIActivity } from "./ai"
import { searchPlace, getPlaceDetails } from "./google-maps"

/**
 * An activity heading into enrichment. May already carry a place the discuss
 * agent resolved via searchPlaces (placeId + coords on the proposal payload).
 * When present these MUST be reused rather than re-searched — see enrichActivity.
 */
type EnrichInputActivity = AIActivity & {
  placeId?: string | null
  lat?: number | null
  lng?: number | null
  address?: string | null
}

export interface EnrichInput {
  days: { dayNumber: number; theme: string; activities: EnrichInputActivity[] }[]
}

/** Google Maps calls, injectable so enrichment can be unit-tested without the API. */
export interface EnrichDeps {
  searchPlace: typeof searchPlace
  getPlaceDetails: typeof getPlaceDetails
}

const defaultDeps: EnrichDeps = { searchPlace, getPlaceDetails }

interface EnrichedActivity extends AIActivity {
  placeId: string | null
  lat: number | null
  lng: number | null
  rating: number | null
  address: string | null
  photos: string[]
  openingHours: string[]
  priceLevel: number | null
}

interface EnrichedDay {
  dayNumber: number
  theme: string
  activities: EnrichedActivity[]
}

export interface EnrichedItinerary {
  days: EnrichedDay[]
  enrichmentFailures: number
}

/**
 * Enrich an AI activity with Google Places data.
 *
 * Two-step:
 *   1. Text Search (Pro SKU) → resolve to a placeId + coordinates.
 *   2. Place Details (Enterprise SKU) → backfill rating, openingHours,
 *      priceLevel. Photos intentionally not fetched — the image feature
 *      is disabled to eliminate Place Photos API spend.
 *
 * Doing both at enrichment time means the trip view never re-hits Google:
 * subsequent reads come straight from the DB. With KV cache the Details
 * call is also free on repeat for popular places.
 */
export async function enrichActivity(
  activity: EnrichInputActivity,
  destination: string,
  destinationCoords?: { lat: number; lng: number },
  deps: EnrichDeps = defaultDeps,
): Promise<EnrichedActivity> {
  // Fast path: the discuss agent already resolved this venue via searchPlaces
  // and put its placeId on the proposal payload. Reuse it and only backfill
  // rating/hours/price by placeId. Re-searching would rebuild the query from
  // the activity's *display* name (e.g. "Coffee at Sơn Trà Marina") biased to
  // the accommodation — which can miss the real place entirely and drop the
  // activity as "could not be geocoded".
  if (activity.placeId) {
    const details = await deps.getPlaceDetails(activity.placeId).catch(() => null)
    return {
      ...activity,
      placeId: activity.placeId,
      lat: activity.lat ?? details?.lat ?? null,
      lng: activity.lng ?? details?.lng ?? null,
      rating: details?.rating ?? null,
      address: activity.address ?? details?.formattedAddress ?? null,
      photos: [],
      openingHours: details?.openingHours ?? [],
      priceLevel: details?.priceLevel ?? null,
    }
  }

  try {
    const candidates = await deps.searchPlace(`${activity.name} ${destination}`, destinationCoords)
    const topResult = candidates[0]

    if (topResult) {
      const details = await deps.getPlaceDetails(topResult.placeId).catch(() => null)

      return {
        ...activity,
        placeId: topResult.placeId,
        lat: topResult.lat,
        lng: topResult.lng,
        rating: details?.rating ?? null,
        address: topResult.formattedAddress ?? null,
        photos: [],
        openingHours: details?.openingHours ?? [],
        priceLevel: details?.priceLevel ?? null,
      }
    }

    console.warn(`[enrich] No Google Places result for: "${activity.name}" in ${destination}`)
  } catch (e) {
    console.error(
      `[enrich] Google Places lookup failed for "${activity.name}":`,
      e instanceof Error ? e.message : e,
    )
  }

  return {
    ...activity,
    placeId: null,
    lat: null,
    lng: null,
    rating: null,
    address: null,
    photos: [],
    openingHours: [],
    priceLevel: null,
  }
}

/**
 * Enrich AI-generated itinerary with Google Maps data.
 * Batches requests in groups of 5 to respect rate limits.
 */
export async function enrichItinerary(
  aiOutput: EnrichInput,
  destination: string,
  destinationCoords?: { lat: number; lng: number },
  deps: EnrichDeps = defaultDeps,
): Promise<EnrichedItinerary> {
  const enrichedDays: EnrichedDay[] = []
  let enrichmentFailures = 0

  for (const day of aiOutput.days) {
    const enrichedActivities: EnrichedActivity[] = []
    const batchSize = 5

    for (let i = 0; i < day.activities.length; i += batchSize) {
      const batch = day.activities.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map((activity) => enrichActivity(activity, destination, destinationCoords, deps)),
      )
      enrichedActivities.push(...results)
    }

    enrichmentFailures += enrichedActivities.filter((a) => a.lat == null || a.lng == null).length

    enrichedDays.push({
      dayNumber: day.dayNumber,
      theme: day.theme,
      activities: enrichedActivities,
    })
  }

  if (enrichmentFailures > 0) {
    console.warn(`[enrich] ${enrichmentFailures} activities could not be geocoded`)
  }

  return { days: enrichedDays, enrichmentFailures }
}

/**
 * Re-enrich a single existing activity by searching Google Places.
 * Returns the enriched fields or null if lookup fails.
 */
export async function enrichSingleActivity(
  activityName: string,
  destination: string,
  destinationCoords?: { lat: number; lng: number },
): Promise<{
  placeId: string
  lat: number
  lng: number
  rating: number | null
  address: string | null
} | null> {
  try {
    const candidates = await searchPlace(`${activityName} ${destination}`, destinationCoords)
    const topResult = candidates[0]

    if (topResult) {
      const details = await getPlaceDetails(topResult.placeId).catch(() => null)
      return {
        placeId: topResult.placeId,
        lat: topResult.lat,
        lng: topResult.lng,
        rating: details?.rating ?? null,
        address: topResult.formattedAddress ?? null,
      }
    }

    console.warn(`[enrich] Re-enrich: no result for "${activityName}" in ${destination}`)
  } catch (e) {
    console.error(
      `[enrich] Re-enrich failed for "${activityName}":`,
      e instanceof Error ? e.message : e,
    )
  }

  return null
}

/**
 * Split enriched activities into those Google could locate (lat AND lng) and
 * those it could not. Callers must NOT persist `unlocated` — a null-coordinate
 * activity is invisible on the map and skipped by the segments engine, so
 * inserting it silently violates the "always validate via Maps" invariant.
 */
export function partitionGeocoded<
  T extends { name: string; lat: number | null; lng: number | null },
>(activities: T[]): { located: T[]; unlocated: T[] } {
  const located: T[] = []
  const unlocated: T[] = []
  for (const a of activities) {
    if (a.lat != null && a.lng != null) located.push(a)
    else unlocated.push(a)
  }
  return { located, unlocated }
}
