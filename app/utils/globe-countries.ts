import { Vector3 } from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { countryByNumeric, type CountryInfo } from "../data/countries"

export const GLOBE_RADIUS = 2

export function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

// --- Parse TopoJSON once ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

export type VisitType = "visited" | "layover" | "want_to_visit"

// --- Country feature list with info ---
export interface CountryGeoFeature {
  id: string
  info: CountryInfo | undefined
  geoFeature: (typeof countriesGeo.features)[number]
}

const allFeatures: CountryGeoFeature[] = countriesGeo.features.map((feat) => {
  const numericId = String(feat.id).padStart(3, "0")
  return { id: numericId, info: countryByNumeric.get(numericId), geoFeature: feat }
})

export function getCountryFeatures(): CountryGeoFeature[] {
  return allFeatures
}

/**
 * Compute the centroid of a country (average lat/lng of polygon vertices).
 */
export function getCountryCentroid(feat: CountryGeoFeature): { lat: number; lng: number } {
  const geo = feat.geoFeature.geometry
  const coords =
    geo.type === "Polygon" ? [geo.coordinates] : geo.type === "MultiPolygon" ? geo.coordinates : []

  let totalLat = 0
  let totalLng = 0
  let count = 0

  for (const polygon of coords) {
    const outer = polygon[0]
    if (!outer) continue
    for (const [lng, lat] of outer) {
      totalLat += lat!
      totalLng += lng!
      count++
    }
  }

  if (count === 0) return { lat: 0, lng: 0 }
  return { lat: totalLat / count, lng: totalLng / count }
}
