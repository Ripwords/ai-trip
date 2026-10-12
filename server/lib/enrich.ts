import type { AIActivity } from "./ai"
import { searchPlace, getPlaceDetails } from "./google-maps"

/**
 * An activity heading into enrichment. May carry a placeId the discuss agent
 * resolved via searchPlaces. That id is only a lookup key: the payload's
 * coordinates and address are never trusted — see resolvePlace.
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

/** A place as Google describes it. Every field comes from Places, none from the caller. */
export interface ResolvedPlace {
  name: string
  placeId: string
  lat: number
  lng: number
  address: string | null
  rating: number | null
  openingHours: string[]
  priceLevel: number | null
}

/** Where to look when a name has to be searched: the trip/day area. */
export interface PlaceArea {
  destination: string
  coords?: { lat: number; lng: number }
}

/**
 * Resolve a place through Google, which is the only source of truth for where
 * it is.
 *
 *   1. A placeId must resolve via Place Details. A 404 (an invented or stale
 *      id) or an outage is not evidence the place exists.
 *   2. Otherwise Text Search by name near the area, then Place Details on the
 *      top hit to backfill rating / hours / price. Photos are intentionally
 *      not fetched — the image feature is disabled to avoid Place Photos spend.
 *   3. Otherwise null: the caller must treat the place as unresolved.
 *
 * Both Google calls are cached, so the trip view never re-hits Google.
 */
export async function resolvePlace(
  query: { name: string; placeId?: string | null },
  area: PlaceArea,
  deps: EnrichDeps = defaultDeps,
): Promise<ResolvedPlace | null> {
  if (query.placeId) {
    const details = await deps.getPlaceDetails(query.placeId).catch(() => null)
    if (details?.placeId) {
      return {
        name: details.name,
        placeId: details.placeId,
        lat: details.lat,
        lng: details.lng,
        address: details.formattedAddress ?? null,
        rating: details.rating ?? null,
        openingHours: details.openingHours ?? [],
        priceLevel: details.priceLevel ?? null,
      }
    }
    console.warn(`[enrich] placeId did not resolve for "${query.name}", searching by name`)
  }

  try {
    const candidates = await deps.searchPlace(`${query.name} ${area.destination}`, area.coords)
    const top = candidates[0]
    if (top?.placeId) {
      const details = await deps.getPlaceDetails(top.placeId).catch(() => null)
      return {
        name: top.name,
        placeId: top.placeId,
        lat: top.lat,
        lng: top.lng,
        address: top.formattedAddress ?? null,
        rating: details?.rating ?? null,
        openingHours: details?.openingHours ?? [],
        priceLevel: details?.priceLevel ?? null,
      }
    }
    console.warn(`[enrich] No Google Places result for: "${query.name}" in ${area.destination}`)
  } catch (e) {
    console.error(
      `[enrich] Google Places lookup failed for "${query.name}":`,
      e instanceof Error ? e.message : e,
    )
  }
  return null
}

/**
 * Enrich an AI activity with Google Places data. Coordinates, placeId and
 * address always come from Google; an activity Google cannot resolve comes
 * back with nulls so `partitionGeocoded` drops it.
 */
export async function enrichActivity(
  activity: EnrichInputActivity,
  destination: string,
  destinationCoords?: { lat: number; lng: number },
  deps: EnrichDeps = defaultDeps,
): Promise<EnrichedActivity> {
  const place = await resolvePlace(
    { name: activity.name, placeId: activity.placeId },
    { destination, coords: destinationCoords },
    deps,
  )
  return {
    ...activity,
    placeId: place?.placeId ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    rating: place?.rating ?? null,
    address: place?.address ?? null,
    photos: [],
    openingHours: place?.openingHours ?? [],
    priceLevel: place?.priceLevel ?? null,
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
