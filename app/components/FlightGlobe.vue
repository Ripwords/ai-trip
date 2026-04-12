<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  BufferGeometry,
  LineBasicMaterial,
  Float32BufferAttribute,
  Vector3,
  QuadraticBezierCurve3,
  Color,
  MeshBasicMaterial,
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

// --- Build country border lines from TopoJSON ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

function buildCountryLines(): BufferGeometry {
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
  return geo
}

const countryLineGeometry = buildCountryLines()
const landBorderMaterial = new LineBasicMaterial({
  color: new Color("#1e2e1a"),
  transparent: true,
  opacity: 0.8,
})

// --- Flight arcs ---
interface ArcData {
  geometry: BufferGeometry
  glowGeometry: BufferGeometry
}

const flightArcs = computed<ArcData[]>(() => {
  const arcs: ArcData[] = []

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
    const glowGeo = new BufferGeometry().setFromPoints(points)

    arcs.push({ geometry: arcGeo, glowGeometry: glowGeo })
  }

  return arcs
})

// --- Airport dots ---
interface AirportDot {
  position: [number, number, number]
  iata: string
}

const airportDots = computed<AirportDot[]>(() => {
  const seen = new Set<string>()
  const dots: AirportDot[] = []

  for (const flight of props.flights) {
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (!code || seen.has(code)) continue
      seen.add(code)

      const coords = getAirportCoordinates(code)
      if (!coords) continue

      const pos = latLngToVector3(coords.lat, coords.lng, GLOBE_RADIUS * 1.003)
      dots.push({ position: [pos.x, pos.y, pos.z], iata: code })
    }
  }

  return dots
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

// --- Materials ---
const arcMaterial = new LineBasicMaterial({
  color: new Color("#e8956a"),
  transparent: true,
  opacity: 0.9,
})

const arcGlowMaterial = new LineBasicMaterial({
  color: new Color("#e8956a"),
  transparent: true,
  opacity: 0.15,
})

const dotMaterial = new MeshBasicMaterial({
  color: new Color("#e8956a"),
})
</script>

<template>
  <div class="relative h-[300px] w-full overflow-hidden rounded-2xl border border-sand-200 bg-sand-950">
    <ClientOnly>
      <TresCanvas :alpha="true" clear-color="#0a0a0f" :antialias="true">
        <!-- Camera -->
        <TresPerspectiveCamera :position="[0, 0, 5]" :fov="45" />

        <!-- Lighting -->
        <TresAmbientLight :intensity="0.3" />
        <TresDirectionalLight :position="[5, 3, 5]" :intensity="0.6" />

        <!-- Controls -->
        <OrbitControls
          :enable-zoom="false"
          :enable-pan="false"
          :auto-rotate="true"
          :auto-rotate-speed="0.5"
          :min-polar-angle="0.5"
          :max-polar-angle="2.6"
        />

        <!-- Ocean sphere -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS, 64, 64]" />
          <TresMeshPhongMaterial color="#080e15" emissive="#050a0f" :shininess="25" />
        </TresMesh>

        <!-- Atmosphere rim (slightly larger transparent sphere) -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS * 1.02, 64, 64]" />
          <TresMeshBasicMaterial color="#4488cc" :transparent="true" :opacity="0.05" :side="1" />
        </TresMesh>

        <!-- Country borders -->
        <TresLineSegments :geometry="countryLineGeometry" :material="landBorderMaterial" />

        <!-- Flight arcs -->
        <template v-for="(arc, idx) in flightArcs" :key="'arc-' + idx">
          <TresLine :geometry="arc.geometry" :material="arcMaterial" />
          <TresLine :geometry="arc.glowGeometry" :material="arcGlowMaterial" />
        </template>

        <!-- Airport dots -->
        <TresMesh v-for="(dot, idx) in airportDots" :key="'dot-' + idx" :position="dot.position">
          <TresSphereGeometry :args="[0.02, 8, 8]" />
          <TresMeshBasicMaterial :color="dotMaterial.color" />
        </TresMesh>
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 text-center">
      <span class="text-xs text-sand-500">{{ summaryText }}</span>
    </div>
  </div>
</template>
