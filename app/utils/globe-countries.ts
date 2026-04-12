import earcut from "earcut"
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { countryByNumeric, type CountryInfo } from "../data/countries"

const GLOBE_RADIUS = 2

export function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

export { GLOBE_RADIUS }

// --- Parse TopoJSON once ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

/** A single polygon: outer ring + optional hole rings */
interface PolygonWithHoles {
  outer: number[][] // [[lng, lat], ...]
  holes: number[][][] // array of hole rings
}

export interface CountryGeoFeature {
  id: string
  info: CountryInfo | undefined
  polygons: PolygonWithHoles[]
}

/** Extract all country features preserving polygon/hole structure */
export function getCountryFeatures(): CountryGeoFeature[] {
  const features: CountryGeoFeature[] = []

  for (const feat of countriesGeo.features) {
    const numericId = String(feat.id).padStart(3, "0")
    const info = countryByNumeric.get(numericId)

    const rawPolygons =
      feat.geometry.type === "Polygon"
        ? [feat.geometry.coordinates]
        : feat.geometry.type === "MultiPolygon"
          ? feat.geometry.coordinates
          : []

    const polygons: PolygonWithHoles[] = []
    for (const polygon of rawPolygons) {
      if (polygon.length === 0 || polygon[0]!.length < 3) continue
      polygons.push({
        outer: polygon[0] as number[][],
        holes: (polygon.slice(1) as number[][][]).filter((h) => h.length >= 3),
      })
    }

    if (polygons.length > 0) {
      features.push({ id: numericId, info, polygons })
    }
  }

  return features
}

/**
 * Triangulate a polygon (outer ring + holes) onto the sphere surface.
 * Earcut receives all vertices flattened + hole start indices.
 */
function triangulatePolygon(
  polygon: PolygonWithHoles,
  radius: number,
): { vertices: number[]; indices: number[] } {
  // Flatten all rings (outer + holes) into one coordinate array for earcut
  const flatCoords: number[] = []
  const holeIndices: number[] = []

  // Outer ring
  for (const [lng, lat] of polygon.outer) {
    flatCoords.push(lng!, lat!)
  }

  // Holes
  let vertexCount = polygon.outer.length
  for (const hole of polygon.holes) {
    holeIndices.push(vertexCount)
    for (const [lng, lat] of hole) {
      flatCoords.push(lng!, lat!)
    }
    vertexCount += hole.length
  }

  const triIndices = earcut(flatCoords, holeIndices.length > 0 ? holeIndices : undefined, 2)

  // Build 3D vertices for all rings
  const vertices: number[] = []
  for (let i = 0; i < flatCoords.length; i += 2) {
    const lng = flatCoords[i]!
    const lat = flatCoords[i + 1]!
    const v = latLngToVector3(lat, lng, radius)
    vertices.push(v.x, v.y, v.z)
  }

  return { vertices, indices: triIndices }
}

/**
 * Build a BufferGeometry for a single country (all its polygons merged).
 */
export function buildCountryGeometry(countryFeature: CountryGeoFeature): BufferGeometry {
  const allVertices: number[] = []
  const allIndices: number[] = []
  let vertexOffset = 0

  for (const polygon of countryFeature.polygons) {
    const { vertices, indices } = triangulatePolygon(polygon, GLOBE_RADIUS * 1.001)
    allVertices.push(...vertices)
    for (const idx of indices) {
      allIndices.push(idx + vertexOffset)
    }
    // Total vertices = outer + all holes
    const totalVerts =
      polygon.outer.length + polygon.holes.reduce((sum, h) => sum + h.length, 0)
    vertexOffset += totalVerts
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(allVertices, 3))
  geo.setIndex(allIndices)
  geo.computeVertexNormals()
  return geo
}

export interface MergedCountryResult {
  geometry: BufferGeometry
  /** Maps face index (triangle index) to the country's numeric ID */
  faceToCountryId: string[]
}

/**
 * Build a single merged geometry for multiple countries.
 * Returns the geometry and a face-to-country lookup array.
 */
export function buildMergedGeometry(features: CountryGeoFeature[]): MergedCountryResult {
  const allVertices: number[] = []
  const allIndices: number[] = []
  const faceToCountryId: string[] = []
  let vertexOffset = 0

  for (const countryFeature of features) {
    for (const polygon of countryFeature.polygons) {
      const { vertices, indices } = triangulatePolygon(polygon, GLOBE_RADIUS * 1.001)
      allVertices.push(...vertices)
      for (let i = 0; i < indices.length; i += 3) {
        allIndices.push(
          indices[i]! + vertexOffset,
          indices[i + 1]! + vertexOffset,
          indices[i + 2]! + vertexOffset,
        )
        faceToCountryId.push(countryFeature.id)
      }
      const totalVerts =
        polygon.outer.length + polygon.holes.reduce((sum, h) => sum + h.length, 0)
      vertexOffset += totalVerts
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(allVertices, 3))
  geo.setIndex(allIndices)
  geo.computeVertexNormals()

  return { geometry: geo, faceToCountryId }
}

/**
 * Build country border lines geometry (same approach as FlightGlobe).
 */
export function buildBorderLines(): BufferGeometry {
  const vertices: number[] = []

  for (const feat of countriesGeo.features) {
    const coords =
      feat.geometry.type === "Polygon"
        ? [feat.geometry.coordinates]
        : feat.geometry.type === "MultiPolygon"
          ? feat.geometry.coordinates
          : []

    for (const polygon of coords) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lng1, lat1] = ring[i]!
          const [lng2, lat2] = ring[i + 1]!
          const v1 = latLngToVector3(lat1!, lng1!, GLOBE_RADIUS * 1.002)
          const v2 = latLngToVector3(lat2!, lng2!, GLOBE_RADIUS * 1.002)
          vertices.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
        }
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3))
  return geo
}

/**
 * Compute the centroid of a country (average lat/lng of outer ring vertices).
 */
export function getCountryCentroid(countryFeature: CountryGeoFeature): {
  lat: number
  lng: number
} {
  let totalLat = 0
  let totalLng = 0
  let count = 0

  for (const polygon of countryFeature.polygons) {
    for (const [lng, lat] of polygon.outer) {
      totalLat += lat!
      totalLng += lng!
      count++
    }
  }

  return { lat: totalLat / count, lng: totalLng / count }
}
