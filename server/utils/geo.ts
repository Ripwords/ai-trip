export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6371

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance in kilometres between two coordinates. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

function hasCoords(v: { lat: number | null; lng: number | null }): v is LatLng {
  return v.lat != null && v.lng != null
}

/**
 * Distance from `anchor` for each activity that is more than `thresholdKm`
 * away, keyed by array index. Activities (or the anchor) without coordinates
 * are skipped. Purely geometric — callers layer time-of-day policy on top.
 */
export function farFromAnchor(
  activities: { lat: number | null; lng: number | null }[],
  anchor: LatLng | null,
  thresholdKm: number,
): { index: number; distanceKm: number }[] {
  if (!anchor || !hasCoords(anchor)) return []
  const out: { index: number; distanceKm: number }[] = []
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i]!
    if (!hasCoords(a)) continue
    const distanceKm = haversineKm(anchor, a)
    if (distanceKm > thresholdKm) out.push({ index: i, distanceKm })
  }
  return out
}
