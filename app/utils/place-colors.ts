/**
 * Place-type colours, modelled on Google Maps: the UI stays neutral and colour
 * only says what kind of place something is. Map pins, list icons, badges and
 * filter chips all read from here so the map and the itinerary agree.
 *
 * `hex` is for Google Maps markers and canvas drawing, which cannot read CSS
 * variables, so it is the same in both themes. The class strings go through
 * the theme ramps and swap in dark mode.
 */
export type PlaceGroup = "sight" | "food" | "stay" | "park" | "transit" | "shop" | "other"

export interface PlaceGroupStyle {
  hex: string
  /** Soft tinted badge: background + readable text. */
  badge: string
  /** Solid swatch for dots and small bars. */
  dot: string
}

export const PLACE_GROUP_STYLE: Record<PlaceGroup, PlaceGroupStyle> = {
  sight: { hex: "#129eaf", badge: "bg-ocean-50 text-ocean-700", dot: "bg-ocean-500" },
  food: { hex: "#e8710a", badge: "bg-amber-50 text-amber-700", dot: "bg-amber-600" },
  stay: { hex: "#d01884", badge: "bg-pink-50 text-pink-700", dot: "bg-pink-600" },
  park: { hex: "#188038", badge: "bg-forest-50 text-forest-700", dot: "bg-forest-600" },
  transit: { hex: "#1a73e8", badge: "bg-terra-50 text-terra-700", dot: "bg-terra-600" },
  shop: { hex: "#9334e6", badge: "bg-purple-50 text-purple-700", dot: "bg-purple-600" },
  other: { hex: "#5f6368", badge: "bg-sand-100 text-sand-700", dot: "bg-sand-500" },
}

const GROUP_OF_TYPE: Record<string, PlaceGroup> = {
  attraction: "sight",
  museum: "sight",
  entertainment: "sight",
  restaurant: "food",
  cafe: "food",
  bar: "food",
  hotel: "stay",
  spa: "stay",
  park: "park",
  nature: "park",
  transport: "transit",
  shopping: "shop",
}

export function placeGroup(type: string | null | undefined): PlaceGroup {
  return (type && GROUP_OF_TYPE[type]) || "other"
}

export function placeStyle(type: string | null | undefined): PlaceGroupStyle {
  return PLACE_GROUP_STYLE[placeGroup(type)]
}
