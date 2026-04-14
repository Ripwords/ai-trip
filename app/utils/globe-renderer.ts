import ThreeGlobe from "three-globe"
import { MeshBasicMaterial } from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { countryByNumeric, type CountryInfo } from "../data/countries"

// Parse TopoJSON → GeoJSON once
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

// Enrich features with country info in properties
const enrichedFeatures = countriesGeo.features.map((feat) => {
  const numericId = String(feat.id).padStart(3, "0")
  const info = countryByNumeric.get(numericId)
  return {
    ...feat,
    properties: {
      ...feat.properties,
      alpha2: info?.alpha2 ?? "",
      numericId,
      countryName: info?.name ?? "",
      region: info?.region ?? "",
    },
  }
})

export type EnrichedFeature = (typeof enrichedFeatures)[number]

export interface GlobeTheme {
  ocean: string
  atmosphere: string
  atmosphereOpacity: number
  border: string
  ambientIntensity: number
  directionalIntensity: number
  clearColor: string
}

export function createGlobe(options: {
  theme: GlobeTheme
  polygonCapColor: (feat: EnrichedFeature) => string
  polygonSideColor?: (feat: EnrichedFeature) => string
  showAtmosphere?: boolean
}): ThreeGlobe {
  const { theme, polygonCapColor, polygonSideColor, showAtmosphere = true } = options

  const globe = new ThreeGlobe({ animateIn: false })
    .globeMaterial(new MeshBasicMaterial({ color: theme.ocean }))
    .showAtmosphere(showAtmosphere)
    .atmosphereColor(theme.atmosphere)
    .atmosphereAltitude(0.15)
    .polygonsData(enrichedFeatures)
    .polygonGeoJsonGeometry((d: EnrichedFeature) => d.geometry)
    .polygonCapColor(polygonCapColor as (obj: object) => string)
    .polygonSideColor((polygonSideColor ?? (() => "rgba(0,0,0,0)")) as (obj: object) => string)
    .polygonStrokeColor(() => theme.border)
    .polygonAltitude(0)
    .polygonCapCurvatureResolution(1)
    .polygonsTransitionDuration(0)

  return globe
}

/**
 * Walk a hit mesh's ancestry to find the three-globe datum (__data)
 * and resolve it to a CountryInfo.
 */
export function getCountryFromMesh(
  obj: { __data?: EnrichedFeature; parent?: unknown } | null,
): CountryInfo | undefined {
  let current = obj
  while (current) {
    const data = (current as { __data?: EnrichedFeature }).__data
    if (data?.properties?.numericId) {
      return countryByNumeric.get(data.properties.numericId)
    }
    current = (current as { parent?: typeof current }).parent ?? null
  }
  return undefined
}

/** Get the enriched features list (for external iteration) */
export function getEnrichedFeatures(): EnrichedFeature[] {
  return enrichedFeatures
}
