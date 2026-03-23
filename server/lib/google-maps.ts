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

// ── Cached: Place Text Search ($35/1K — cache 24h) ──────────────────

const _searchPlace = defineCachedFunction(
  async (_event: unknown, query: string): Promise<PlaceCandidate[]> => {
    const response = await $fetch<{ places?: Array<Record<string, unknown>> }>(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": MAPS_API_KEY,
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
  },
  {
    maxAge: 60 * 60 * 24, // 24 hours — place data rarely changes
    name: "searchPlace",
    group: "maps",
    getKey: (_event: unknown, query: string) => query.toLowerCase().trim(),
  }
);

export function searchPlace(query: string): Promise<PlaceCandidate[]> {
  return _searchPlace(null, query);
}

// ── Cached: Distance Matrix ($5/1K — cache 6h) ──────────────────────

const _getDistanceMatrix = defineCachedFunction(
  async (
    _event: unknown,
    originsStr: string,
    destinationsStr: string
  ): Promise<DistanceMatrixEntry[][]> => {
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
  },
  {
    maxAge: 60 * 60 * 6, // 6 hours — travel times can vary by time of day
    name: "distanceMatrix",
    group: "maps",
    getKey: (_event: unknown, originsStr: string, destinationsStr: string) =>
      `${originsStr}__${destinationsStr}`,
  }
);

export function getDistanceMatrix(
  origins: LatLng[],
  destinations: LatLng[]
): Promise<DistanceMatrixEntry[][]> {
  // Round coordinates to 4 decimal places (~11m accuracy) to improve cache hits
  const originsStr = origins.map((o) => `${o.lat.toFixed(4)},${o.lng.toFixed(4)}`).join("|");
  const destinationsStr = destinations.map((d) => `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`).join("|");
  return _getDistanceMatrix(null, originsStr, destinationsStr);
}

// ── Cached: Place Details ($5-10/1K — cache 7 days) ──────────────────

const _getPlaceDetails = defineCachedFunction(
  async (_event: unknown, placeId: string): Promise<PlaceDetails | null> => {
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
  },
  {
    maxAge: 60 * 60 * 24 * 7, // 7 days — place details are very stable
    name: "placeDetails",
    group: "maps",
    getKey: (_event: unknown, placeId: string) => placeId,
  }
);

export function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  return _getPlaceDetails(null, placeId);
}

// ── Cached: Geocode ($5/1K — cache 30 days) ──────────────────────────

const _geocode = defineCachedFunction(
  async (
    _event: unknown,
    address: string
  ): Promise<{ lat: number; lng: number; formattedAddress: string } | null> => {
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

    const result = response.results[0]!;
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    };
  },
  {
    maxAge: 60 * 60 * 24 * 30, // 30 days — addresses don't move
    name: "geocode",
    group: "maps",
    getKey: (_event: unknown, address: string) => address.toLowerCase().trim(),
  }
);

export function geocode(
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  return _geocode(null, address);
}
