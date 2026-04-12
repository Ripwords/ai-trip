import { geoEquirectangular, geoPath } from "d3-geo"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import { CanvasTexture, Vector3, SRGBColorSpace } from "three"
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

// --- Canvas texture approach ---
const TEX_WIDTH = 4096
const TEX_HEIGHT = 2048

const projection = geoEquirectangular()
  .scale(TEX_WIDTH / (2 * Math.PI))
  .translate([TEX_WIDTH / 2, TEX_HEIGHT / 2])

const pathGenerator = geoPath().projection(projection)

export interface GlobeColors {
  ocean: string
  unvisited: string
  visited: string
  layover: string
  want: string
  border: string
  borderWidth: number
}

/**
 * Render a color texture for the globe with countries colored by visit status.
 */
export function renderGlobeTexture(
  visitMap: Map<string, VisitType>,
  colors: GlobeColors,
): CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = TEX_WIDTH
  canvas.height = TEX_HEIGHT
  const ctx = canvas.getContext("2d")!

  // Ocean background
  ctx.fillStyle = colors.ocean
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT)

  // Draw each country filled
  for (const feat of allFeatures) {
    const visitType = feat.info ? visitMap.get(feat.info.alpha2) : undefined

    if (visitType === "visited") ctx.fillStyle = colors.visited
    else if (visitType === "layover") ctx.fillStyle = colors.layover
    else if (visitType === "want_to_visit") ctx.fillStyle = colors.want
    else ctx.fillStyle = colors.unvisited

    ctx.beginPath()
    pathGenerator.context(ctx)(feat.geoFeature)
    ctx.fill()
  }

  // Draw borders on top
  ctx.strokeStyle = colors.border
  ctx.lineWidth = colors.borderWidth
  for (const feat of allFeatures) {
    ctx.beginPath()
    pathGenerator.context(ctx)(feat.geoFeature)
    ctx.stroke()
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Render an ID texture where each country has a unique color.
 * Used for click/hover detection: raycast → UV → pixel → country ID.
 *
 * Country numeric IDs are encoded as RGB: R = id >> 8, G = id & 0xFF, B = 0.
 * Background (ocean) is black (0,0,0).
 */
export function renderIdTexture(): {
  texture: CanvasTexture
  canvas: HTMLCanvasElement
} {
  const canvas = document.createElement("canvas")
  canvas.width = TEX_WIDTH
  canvas.height = TEX_HEIGHT
  const ctx = canvas.getContext("2d")!

  // Ocean = black (no country)
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT)

  // Each country gets a unique color based on its numeric ID
  for (const feat of allFeatures) {
    const id = parseInt(feat.id, 10)
    // Encode as RGB (avoid 0,0,0 which is ocean)
    const r = ((id + 1) >> 8) & 0xff
    const g = (id + 1) & 0xff
    ctx.fillStyle = `rgb(${r},${g},0)`
    ctx.beginPath()
    pathGenerator.context(ctx)(feat.geoFeature)
    ctx.fill()
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return { texture, canvas }
}

/**
 * Resolve a country from UV coordinates on the globe by reading the ID texture.
 */
export function resolveCountryFromUV(
  u: number,
  v: number,
  idCanvas: HTMLCanvasElement,
): CountryInfo | undefined {
  const ctx = idCanvas.getContext("2d")!
  const x = Math.floor(u * TEX_WIDTH)
  const y = Math.floor(v * TEX_HEIGHT)
  const pixel = ctx.getImageData(x, y, 1, 1).data
  const r = pixel[0]!
  const g = pixel[1]!

  // Decode: id = (r << 8 | g) - 1
  const encoded = (r << 8) | g
  if (encoded === 0) return undefined // ocean

  const numericId = String(encoded - 1).padStart(3, "0")
  return countryByNumeric.get(numericId)
}

/**
 * Compute the centroid of a country (average lat/lng of polygon vertices).
 */
export function getCountryCentroid(feat: CountryGeoFeature): { lat: number; lng: number } {
  const geo = feat.geoFeature.geometry
  const coords =
    geo.type === "Polygon"
      ? [geo.coordinates]
      : geo.type === "MultiPolygon"
        ? geo.coordinates
        : []

  let totalLat = 0
  let totalLng = 0
  let count = 0

  for (const polygon of coords) {
    // Only use outer ring for centroid
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
