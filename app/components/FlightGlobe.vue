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
  MeshPhongMaterial,
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

const { isDark } = useDarkMode()

// --- Theme palettes derived from the app's design tokens ---
// Dark: warm parchment-at-night — sand-900 ocean, forest borders, terra arcs
// Light: sun-bleached antique map — ocean-100 water, forest land outlines, terra routes
const theme = computed(() =>
  isDark.value
    ? {
        // Canvas background = sand-50 dark (#1a1714)
        clearColor: "#1a1714",
        // Ocean = between sand-50 dark and sand-100 dark — deep warm charcoal
        ocean: "#1e1b16",
        oceanEmissive: "#15120e",
        // Atmosphere = terra-500 dark glow, very subtle
        atmosphere: "#e85d3a",
        atmosphereOpacity: 0.04,
        // Land borders = forest-400 dark — recognizable green on dark
        borderColor: "#4a8450",
        borderOpacity: 0.55,
        // Flight arcs = terra-400 dark — the hero color, bright and warm
        arcColor: "#f07b5a",
        // Airport dots = terra-300 dark — slightly different to read as distinct
        dotColor: "#f7a48a",
        ambientIntensity: 0.5,
        directionalIntensity: 0.9,
      }
    : {
        // Canvas background = sand-50 light (#faf8f5)
        clearColor: "#faf8f5",
        // Ocean = ocean-100 light — soft teal water, clearly reads as sea
        ocean: "#d9eef3",
        oceanEmissive: "#b3dde7",
        // Atmosphere = ocean-300 — gentle coastal haze
        atmosphere: "#7dc3d4",
        atmosphereOpacity: 0.06,
        // Land borders = forest-600 — rich green that pops on light ocean
        borderColor: "#3a6a3f",
        borderOpacity: 0.7,
        // Flight arcs = terra-600 — deep warm orange, readable on light globe
        arcColor: "#d44425",
        // Airport dots = terra-500 — vibrant marker
        dotColor: "#e85d3a",
        ambientIntensity: 0.9,
        directionalIntensity: 1.4,
      },
)

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

  const center = new Vector3()
  for (const pos of airportPositions) {
    center.add(pos)
  }
  center.divideScalar(airportPositions.length)

  const cameraDir = center.normalize().multiplyScalar(5)
  return [cameraDir.x, cameraDir.y, cameraDir.z]
})

// --- Build country border lines from TopoJSON ---
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

function buildCountryLineGeometry(): BufferGeometry {
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

const borderGeometry = buildCountryLineGeometry()
const borderMaterial = new LineBasicMaterial({
  color: new Color(theme.value.borderColor),
  transparent: true,
  opacity: theme.value.borderOpacity,
})
const countryLines = new LineSegments(borderGeometry, borderMaterial)

// Update border material when theme changes
watch(theme, (t) => {
  borderMaterial.color.set(t.borderColor)
  borderMaterial.opacity = t.borderOpacity
  borderMaterial.needsUpdate = true
})

// --- Build flight arcs + airport dots as a Group ---
const flightGroup = computed(() => {
  const group = new Group()
  const t = theme.value

  const arcMaterial = new LineBasicMaterial({
    color: new Color(t.arcColor),
    transparent: true,
    opacity: 0.9,
  })

  const dotMaterial = new MeshBasicMaterial({
    color: new Color(t.dotColor),
  })

  const dotGeo = new SphereGeometry(0.035, 12, 12)
  const seen = new Set<string>()

  for (const flight of props.flights) {
    if (!flight.departureAirport || !flight.arrivalAirport) continue

    const depCoords = getAirportCoordinates(flight.departureAirport)
    const arrCoords = getAirportCoordinates(flight.arrivalAirport)
    if (!depCoords || !arrCoords) continue

    const start = latLngToVector3(depCoords.lat, depCoords.lng, GLOBE_RADIUS * 1.002)
    const end = latLngToVector3(arrCoords.lat, arrCoords.lng, GLOBE_RADIUS * 1.002)

    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
    const distance = start.distanceTo(end)
    const arcHeight = GLOBE_RADIUS + 0.3 + distance * 0.15
    const midElevated = mid.normalize().multiplyScalar(arcHeight)

    const curve = new QuadraticBezierCurve3(start, midElevated, end)
    const points = curve.getPoints(64)
    const arcGeo = new BufferGeometry().setFromPoints(points)

    const arcLine = new Line(arcGeo, arcMaterial)
    group.add(arcLine)

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
  <div class="relative h-[300px] w-full overflow-hidden rounded-2xl border border-sand-200">
    <ClientOnly>
      <TresCanvas :alpha="true" :clear-color="theme.clearColor" :antialias="true">
        <TresPerspectiveCamera :position="cameraPosition" :fov="45" />

        <TresAmbientLight :intensity="theme.ambientIntensity" />
        <TresDirectionalLight :position="[5, 3, 5]" :intensity="theme.directionalIntensity" />

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
          <TresMeshPhongMaterial
            :color="theme.ocean"
            :emissive="theme.oceanEmissive"
            :shininess="40"
          />
        </TresMesh>

        <!-- Atmosphere rim -->
        <TresMesh>
          <TresSphereGeometry :args="[GLOBE_RADIUS * 1.02, 64, 64]" />
          <TresMeshBasicMaterial
            :color="theme.atmosphere"
            :transparent="true"
            :opacity="theme.atmosphereOpacity"
            :side="1"
          />
        </TresMesh>

        <!-- Country borders -->
        <primitive :object="countryLines" />

        <!-- Flight arcs + airport dots -->
        <primitive :object="flightGroup" />
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 text-center">
      <span class="font-display text-xs tracking-wide text-sand-500">{{ summaryText }}</span>
    </div>
  </div>
</template>
