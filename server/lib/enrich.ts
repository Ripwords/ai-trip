import type { AIItineraryOutput, AIActivity } from "./ai";
import { searchPlace } from "./google-maps";

interface EnrichedActivity extends AIActivity {
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  address: string | null;
  photos: string[];
  openingHours: string[];
  priceLevel: number | null;
}

interface EnrichedDay {
  dayNumber: number;
  theme: string;
  activities: EnrichedActivity[];
}

export interface EnrichedItinerary {
  days: EnrichedDay[];
}

async function enrichActivity(
  activity: AIActivity,
  destination: string
): Promise<EnrichedActivity> {
  try {
    const candidates = await searchPlace(`${activity.name} ${destination}`);
    const topResult = candidates[0];

    if (topResult) {
      return {
        ...activity,
        placeId: topResult.placeId,
        lat: topResult.lat,
        lng: topResult.lng,
        rating: topResult.rating ?? null,
        address: topResult.formattedAddress ?? null,
        photos: [],
        openingHours: [],
        priceLevel: null,
      };
    }
  } catch {
    // If Google Maps lookup fails, return activity without enrichment
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
  };
}

/**
 * Enrich AI-generated itinerary with Google Maps data.
 * Batches requests in groups of 5 to respect rate limits.
 */
export async function enrichItinerary(
  aiOutput: AIItineraryOutput,
  destination: string
): Promise<EnrichedItinerary> {
  const enrichedDays: EnrichedDay[] = [];

  for (const day of aiOutput.days) {
    const enrichedActivities: EnrichedActivity[] = [];
    const batchSize = 5;

    for (let i = 0; i < day.activities.length; i += batchSize) {
      const batch = day.activities.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((activity) => enrichActivity(activity, destination))
      );
      enrichedActivities.push(...results);
    }

    enrichedDays.push({
      dayNumber: day.dayNumber,
      theme: day.theme,
      activities: enrichedActivities,
    });
  }

  return { days: enrichedDays };
}
