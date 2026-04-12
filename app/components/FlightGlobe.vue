<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Line,
  Float32BufferAttribute,
  Vector3,
  QuadraticBezierCurve3,
  Color,
  MeshBasicMaterial,
  Group,
  SphereGeometry,
  Mesh,
} from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import worldTopoJson from "../data/countries-50m.json"
import { getAirportCoordinates } from "../utils/airport-coordinates"
import { iataToCountry } from "../utils/iata-to-country"

interface Flight {
  departureAirport: string | null
  arrivalAirport: string | null
  [key: string]: unknown
}

const props = defineProps<{
  flights: Flight[]
}>()

const GLOBE_RADIUS = 2

// --- Convert lat/lng to 3D position on sphere ---
function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

// --- Compute initial camera position centered on flight midpoint ---
const cameraPosition = computed<[number, number, number]>(() => {
  const airportPositions: Vector3[] = []

  for (const flight of props.flights) {
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (!code) continue
      const coords = getAirportCoordinates(code)
      if (!coords) continue
      airportPositions.push(latLngToVector3(coords.lat, coords.lng, GLOBE_RADIUS))
    }
  }

  if (airportPositions.length === 0) return [0, 0, 5]

  // Average all airport positions to find center, then place camera looking at that point
  const center = new Vector3()
  for (const pos of airportPositions) {
    center.add(pos)
  }
  center.divideScalar(airportPositions.length)

  // Camera looks from the direction of the center point, pushed out to distance 5
  const cameraDir = center.normalize().multiplyScalar(5)
  return [cameraDir.x, cameraDir.y, cameraDir.z]
})

// --- Build country border lines from TopoJSON ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

function buildCountryLines(): LineSegments {
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
          const v1 = latLngToVector3(lat1!, lng1!, GLOBE_RADIUS * 1.001)
          const v2 = latLngToVector3(lat2!, lng2!, GLOBE_RADIUS * 1.001)
          vertices.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
        }
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3))

  const material = new LineBasicMaterial({
    color: new Color("#4d7a46"),
    transparent: true,
    opacity: 0.7,
  })

  return new LineSegments(geo, material)
}

const countryLines = buildCountryLines()

// --- Build flight arcs + airport dots as a Group ---
const flightGroup = computed(() => {
  const group = new Group()

  const arcMaterial = new LineBasicMaterial({
    color: new Color("#e8956a"),
    transparent: true,
    opacity: 0.9,
  })

  const dotMaterial = new MeshBasicMaterial({
    color: new Color("#e8956a"),
  })

  const dotGeo = new SphereGeometry(0.03, 8, 8)
  const seen = new Set<string>()

  for (const flight of props.flights) {
    if (!flight.departureAirport || !flight.arrivalAirport) continue

    const depCoords = getAirportCoordinates(flight.departureAirport)
    const arrCoords = getAirportCoordinates(flight.arrivalAirport)
    if (!depCoords || !arrCoords) continue

    const start = latLngToVector3(depCoords.lat, depCoords.lng, GLOBE_RADIUS * 1.002)
    const end = latLngToVector3(arrCoords.lat, arrCoords.lng, GLOBE_RADIUS * 1.002)

    // Midpoint elevated above the globe surface
    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
    const distance = start.distanceTo(end)
    const arcHeight = GLOBE_RADIUS + 0.3 + distance * 0.15
    const midElevated = mid.normalize().multiplyScalar(arcHeight)

    const curve = new QuadraticBezierCurve3(start, midElevated, end)
    const points = curve.getPoints(64)
    const arcGeo = new BufferGeometry().setFromPoints(points)

    // Arc line
    const arcLine = new Line(arcGeo, arcMaterial)
    group.add(arcLine)

    // Airport dots
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (seen.has(code)) continue
      seen.add(code)

      const coords = getAirportCoordinates(code)
      if (!coords) continue

      const pos = latLngToVector3(coords.lat, coords.lng, GLOBE_RADIUS * 1.003)
      const dot = new Mesh(dotGeo, dotMaterial)
      dot.position.set(pos.x, pos.y, pos.z)
      group.add(dot)
    }
  }

  return group
})

// --- Summary text ---
const summaryText = computed(() => {
  const countries = new Set<string>()
  let flightCount = 0

  for (const flight of props.flights) {
    if (flight.departureAirport || flight.arrivalAirport) flightCount++
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (!code) continue
      const country = iataToCountry[code]
      if (country) countries.add(country)
    }
  }

  return `${flightCount} flight${flightCount !== 1 ? "s" : ""} · ${countries.size} countr${countries.size !== 1 ? "ies" : "y"}`
})
</script>

<template>
  <div
    class="relative h-[300px] w-full overflow-hidden rounded-2xl border border-sand-200 bg-sand-950"
  >
    <ClientOnly>
      <TresCanvas :alpha="true" clear-color="#0d1220" :antialias="true">
        <!-- Camera positioned to face flight center -->
        <TresPerspectiveCamera :position="cameraPosition" :fov="45" />

        <!-- Brighter lighting -->
        <TresAmbientLight :intensity="0.6" />
        <TresDirectionalLight :position="[5, 3, 5]" :intensity="1.0" />

        <!-- Controls -->
        <OrbitControls
          :enable-zoom="false"
          :enable-pan="false"
          :auto-rotate="true"
          :auto-rotate-speed="0.3"
          :min-polar-angle="0.5"
          :max-polar-angle="2.6"
        />

        <!-- Ocean sphere -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS, 64, 64]" />
          <TresMeshPhongMaterial color="#0f1d2d" emissive="#0a1525" :shininess="30" />
        </TresMesh>

        <!-- Atmosphere rim -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS * 1.025, 64, 64]" />
          <TresMeshBasicMaterial color="#5599dd" :transparent="true" :opacity="0.08" :side="1" />
        </TresMesh>

        <!-- Country borders -->
        <primitive :object="countryLines" />

        <!-- Flight arcs + airport dots -->
        <primitive :object="flightGroup" />
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 text-center">
      <span class="text-xs text-sand-500">{{ summaryText }}</span>
    </div>
  </div>
</template>
