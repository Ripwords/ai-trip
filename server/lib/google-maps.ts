interface LatLng {
  lat: number;
  lng: number;
}

interface PlaceCandidate {
  name: string;
  placeId: string;
  lat: number;
  lng: number;
  rating?: number;
  formattedAddress?: string;
  types?: string[];
}

interface PlaceDetails {
  name: string;
  placeId: string;
  lat: number;
  lng: number;
  rating?: number;
  formattedAddress?: string;
  types?: string[];
  photos?: string[];
  openingHours?: string[];
  priceLevel?: number;
  editorialSummary?: string;
}

interface DistanceMatrixEntry {
  distance: { text: string; value: number };
  duration: { text: string; value: number };
  status: string;
}

const MAPS_API_KEY = process.env.NUXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

/**
 * Search for a place using the Places API (New) Text Search.
 */
export async function searchPlace(query: string): Promise<PlaceCandidate[]> {
  const response = await $fetch<{ places?: Array<Record<string, unknown>> }>(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": MAPS_API_KEY,
        // Advanced fields ($35/1K) — includes rating but avoids photos (Preferred: $40/1K)
        "X-Goog-FieldMask":
          "places.displayName,places.id,places.location,places.rating,places.formattedAddress,places.types",
      },
      body: { textQuery: query },
    }
  );

  if (!response.places) return [];

  return response.places.map((place) => {
    const location = place.location as { latitude: number; longitude: number } | undefined;
    const displayName = place.displayName as { text: string } | undefined;

    return {
      name: displayName?.text ?? "",
      placeId: (place.id as string) ?? "",
      lat: location?.latitude ?? 0,
      lng: location?.longitude ?? 0,
      rating: place.rating as number | undefined,
      formattedAddress: place.formattedAddress as string | undefined,
      types: place.types as string[] | undefined,
    };
  });
}

/**
 * Get full place details using the Places API (New).
 */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const response = await $fetch<Record<string, unknown>>(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": MAPS_API_KEY,
        "X-Goog-FieldMask":
          "displayName,id,location,rating,formattedAddress,types,photos,regularOpeningHours,priceLevel,editorialSummary",
      },
    }
  );

  if (!response) return null;

  const location = response.location as { latitude: number; longitude: number } | undefined;
  const displayName = response.displayName as { text: string } | undefined;
  const photos = response.photos as Array<{ name: string }> | undefined;
  const openingHours = response.regularOpeningHours as {
    weekdayDescriptions?: string[];
  } | undefined;
  const editorialSummary = response.editorialSummary as { text: string } | undefined;

  // Map priceLevel enum string to numeric value
  const priceLevelMap: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };

  return {
    name: displayName?.text ?? "",
    placeId: (response.id as string) ?? "",
    lat: location?.latitude ?? 0,
    lng: location?.longitude ?? 0,
    rating: response.rating as number | undefined,
    formattedAddress: response.formattedAddress as string | undefined,
    types: response.types as string[] | undefined,
    photos: photos?.slice(0, 3).map((p) => p.name) ?? [],
    openingHours: openingHours?.weekdayDescriptions,
    priceLevel: priceLevelMap[response.priceLevel as string],
    editorialSummary: editorialSummary?.text,
  };
}

/**
 * Get distance matrix between origins and destinations.
 */
export async function getDistanceMatrix(
  origins: LatLng[],
  destinations: LatLng[]
): Promise<DistanceMatrixEntry[][]> {
  const originsStr = origins.map((o) => `${o.lat},${o.lng}`).join("|");
  const destinationsStr = destinations.map((d) => `${d.lat},${d.lng}`).join("|");

  const response = await $fetch<{
    rows: Array<{ elements: DistanceMatrixEntry[] }>;
    status: string;
  }>("https://maps.googleapis.com/maps/api/distancematrix/json", {
    params: {
      origins: originsStr,
      destinations: destinationsStr,
      key: MAPS_API_KEY,
    },
  });

  if (response.status !== "OK") {
    throw createError({
      statusCode: 502,
      message: `Distance Matrix API error: ${response.status}`,
    });
  }

  return response.rows.map((row) => row.elements);
}

/**
 * Geocode an address to lat/lng.
 */
export async function geocode(
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const response = await $fetch<{
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
    }>;
    status: string;
  }>("https://maps.googleapis.com/maps/api/geocode/json", {
    params: {
      address,
      key: MAPS_API_KEY,
    },
  });

  if (response.status !== "OK" || response.results.length === 0) {
    return null;
  }

  const result = response.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}
