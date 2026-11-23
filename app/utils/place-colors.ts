/**
 * Place-type colours: the UI stays neutral and colour only says what kind of place something is. Map pins, list icons, badges and
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
  sight: { hex: "#04848f", badge: "bg-ocean-50 text-ocean-700", dot: "bg-ocean-600" },
  food: { hex: "#bf7613", badge: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  stay: { hex: "#b14c79", badge: "bg-pink-50 text-pink-700", dot: "bg-pink-600" },
  park: { hex: "#2d8949", badge: "bg-forest-50 text-forest-700", dot: "bg-forest-600" },
  transit: { hex: "#2d78bd", badge: "bg-sky-50 text-sky-700", dot: "bg-sky-600" },
  shop: { hex: "#885cb5", badge: "bg-purple-50 text-purple-700", dot: "bg-purple-600" },
  other: { hex: "#5b5851", badge: "bg-sand-100 text-sand-700", dot: "bg-sand-500" },
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
  // Unrecognised types read as sights, never as grey: a grey pin says nothing
  // and disappears into the dark basemap.
  return (type && GROUP_OF_TYPE[type]) || "sight"
}

export function placeStyle(type: string | null | undefined): PlaceGroupStyle {
  return PLACE_GROUP_STYLE[placeGroup(type)]
}

/**
 * Fill and label colour for a map pin. The dark basemap is warm grey, so a
 * grey pin vanishes into it: on a dark map, colourless pins flip to a light
 * fill with dark text. Coloured pins are left alone.
 */
export function pinColors(hex: string, onDarkMap: boolean): { fill: string; text: string } {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const isGrey = Math.max(...channels) - Math.min(...channels) < 24
  return onDarkMap && isGrey ? { fill: "#f4efe6", text: "#1c1810" } : { fill: hex, text: "#ffffff" }
}
