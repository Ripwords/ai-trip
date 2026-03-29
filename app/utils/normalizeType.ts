/**
 * Normalize Google Places API types to the app's activity type vocabulary.
 * Google returns types like "tourist_attraction", "meal_takeaway", "lodging".
 * We normalize to simpler labels used in badges and AI.
 */
const TYPE_MAP: Record<string, string> = {
  tourist_attraction: "attraction",
  point_of_interest: "attraction",
  establishment: "attraction",
  natural_feature: "nature",
  park: "park",
  museum: "museum",
  art_gallery: "museum",
  restaurant: "restaurant",
  food: "restaurant",
  meal_takeaway: "restaurant",
  meal_delivery: "restaurant",
  bakery: "cafe",
  cafe: "cafe",
  bar: "bar",
  night_club: "bar",
  lodging: "hotel",
  hotel: "hotel",
  shopping_mall: "shopping",
  clothing_store: "shopping",
  store: "shopping",
  amusement_park: "entertainment",
  movie_theater: "entertainment",
  bowling_alley: "entertainment",
  spa: "spa",
  gym: "spa",
  train_station: "transport",
  bus_station: "transport",
  airport: "transport",
  transit_station: "transport",
  subway_station: "transport",
  church: "attraction",
  hindu_temple: "attraction",
  mosque: "attraction",
  synagogue: "attraction",
  place_of_worship: "attraction",
};

export function normalizeGooglePlaceType(googleType: string | undefined | null): string {
  if (!googleType) return "attraction";
  return TYPE_MAP[googleType] ?? googleType.replace(/_/g, " ");
}
