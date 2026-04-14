import earcut from "earcut"
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  Vector3,
} from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { countryByNumeric, type CountryInfo } from "../data/countries"

const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

/** Convert lat/lng (degrees) to a 3D point on a sphere of given radius */
function spherePoint(lat: number, lng: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return [
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
}

/**
 * Triangulate a single polygon ring (array of [lng, lat] coordinates)
 * using earcut in 2D lat/lng space, then project to 3D sphere.
 */
function triangulateRing(
  outerRing: number[][],
  holes: number[][][],
  radius: number,
): { positions: number[]; faceCount: number } {
  const flatCoords: number[] = []
  const holeIndices: number[] = []

  // Outer ring
  for (const [lng, lat] of outerRing) {
    flatCoords.push(lng!, lat!)
  }

  // Holes
  for (const hole of holes) {
    holeIndices.push(flatCoords.length / 2)
    for (const [lng, lat] of hole) {
      flatCoords.push(lng!, lat!)
    }
  }

  const indices = earcut(flatCoords, holeIndices.length > 0 ? holeIndices : undefined, 2)

  const positions: number[] = []
  for (const idx of indices) {
    const lng = flatCoords[idx * 2]!
    const lat = flatCoords[idx * 2 + 1]!
    const [x, y, z] = spherePoint(lat, lng, radius)
    positions.push(x, y, z)
  }

  return { positions, faceCount: indices.length / 3 }
}

export interface CountryHitMeshResult {
  mesh: Mesh
  /** Map from face index → CountryInfo */
  faceToCountry: CountryInfo[]
}

/**
 * Build a single merged mesh of all country polygons for hit-testing.
 * The mesh is invisible (transparent) and slightly above the visual globe surface.
 * Returns the mesh + a face-index-to-country lookup array.
 */
export function buildCountryHitMesh(globeRadius: number, debug = false): CountryHitMeshResult {
  // Place hit mesh slightly outside the visual globe so raycasts hit it first
  const hitRadius = globeRadius * 1.005

  const allPositions: number[] = []
  const faceToCountry: CountryInfo[] = []

  for (const feat of countriesGeo.features) {
    const numericId = String(feat.id).padStart(3, "0")
    const countryInfo = countryByNumeric.get(numericId)
    if (!countryInfo) continue

    const geo = feat.geometry
    const polygons =
      geo.type === "Polygon"
        ? [geo.coordinates]
        : geo.type === "MultiPolygon"
          ? geo.coordinates
          : []

    for (const polygon of polygons) {
      const outerRing = polygon[0]
      if (!outerRing || outerRing.length < 3) continue
      const holes = polygon.slice(1)

      const { positions, faceCount } = triangulateRing(outerRing, holes, hitRadius)
      allPositions.push(...positions)

      // Map each face to this country
      for (let i = 0; i < faceCount; i++) {
        faceToCountry.push(countryInfo)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(allPositions, 3))
  geometry.computeVertexNormals()

  const material = debug
    ? new MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
        side: DoubleSide,
        depthTest: false,
      })
    : new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
      })

  const mesh = new Mesh(geometry, material)
  return { mesh, faceToCountry }
}
