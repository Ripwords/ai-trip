import type { AIItineraryOutput, AIActivity } from "./ai"
import { searchPlace, getPlaceDetails } from "./google-maps"

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
async function enrichActivity(
  activity: AIActivity,
  destination: string,
  destinationCoords?: { lat: number; lng: number },
): Promise<EnrichedActivity> {
  try {
    const candidates = await searchPlace(`${activity.name} ${destination}`, destinationCoords)
    const topResult = candidates[0]

    if (topResult) {
      const details = await getPlaceDetails(topResult.placeId).catch(() => null)

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
  aiOutput: AIItineraryOutput,
  destination: string,
  destinationCoords?: { lat: number; lng: number },
): Promise<EnrichedItinerary> {
  const enrichedDays: EnrichedDay[] = []
  let enrichmentFailures = 0

  for (const day of aiOutput.days) {
    const enrichedActivities: EnrichedActivity[] = []
    const batchSize = 5

    for (let i = 0; i < day.activities.length; i += batchSize) {
      const batch = day.activities.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map((activity) => enrichActivity(activity, destination, destinationCoords)),
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
