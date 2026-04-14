<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import { Vector3 } from "three"
import { createGlobe, type GlobeTheme } from "../utils/globe-renderer"
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

const theme = computed(() =>
  isDark.value
    ? {
        clearColor: "#1a1714",
        ocean: "#1e1b16",
        atmosphere: "#e85d3a",
        atmosphereOpacity: 0.04,
        border: "#4a8450",
        ambientIntensity: 0.5,
        directionalIntensity: 0.9,
        landColor: "#302b24",
        arcColor: "#f07b5a",
        dotColor: "#f7a48a",
      }
    : {
        clearColor: "#faf8f5",
        ocean: "#d9eef3",
        atmosphere: "#7dc3d4",
        atmosphereOpacity: 0.06,
        border: "#3a6a3f",
        ambientIntensity: 0.9,
        directionalIntensity: 1.4,
        landColor: "#e8e0d4",
        arcColor: "#d44425",
        dotColor: "#e85d3a",
      },
)

// --- Globe instance ---
const globe = createGlobe({
  theme: theme.value as GlobeTheme,
  polygonCapColor: () => theme.value.landColor,
})

// --- Build arc and point data from flights ---
interface ArcDatum {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
}

interface PointDatum {
  lat: number
  lng: number
}

function updateFlightData() {
  const arcs: ArcDatum[] = []
  const points: PointDatum[] = []
  const seenAirports = new Set<string>()

  for (const flight of props.flights) {
    if (!flight.departureAirport || !flight.arrivalAirport) continue

    const depCoords = getAirportCoordinates(flight.departureAirport)
    const arrCoords = getAirportCoordinates(flight.arrivalAirport)
    if (!depCoords || !arrCoords) continue

    arcs.push({
      startLat: depCoords.lat,
      startLng: depCoords.lng,
      endLat: arrCoords.lat,
      endLng: arrCoords.lng,
    })

    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (seenAirports.has(code)) continue
      seenAirports.add(code)
      const coords = getAirportCoordinates(code)
      if (coords) points.push({ lat: coords.lat, lng: coords.lng })
    }
  }

  globe
    .arcsData(arcs)
    .arcStartLat((d: object) => (d as ArcDatum).startLat)
    .arcStartLng((d: object) => (d as ArcDatum).startLng)
    .arcEndLat((d: object) => (d as ArcDatum).endLat)
    .arcEndLng((d: object) => (d as ArcDatum).endLng)
    .arcColor(() => theme.value.arcColor)
    .arcAltitudeAutoScale(0.3)
    .arcStroke(0.5)

  globe
    .pointsData(points)
    .pointLat((d: object) => (d as PointDatum).lat)
    .pointLng((d: object) => (d as PointDatum).lng)
    .pointColor(() => theme.value.dotColor)
    .pointRadius(0.4)
    .pointAltitude(0.01)
}

// Update flight data when flights change
watch(() => props.flights, updateFlightData, { immediate: true })

// Update colors when theme changes
watch(theme, (t) => {
  globe
    .polygonCapColor(() => t.landColor)
    .polygonStrokeColor(() => t.border)
    .arcColor(() => t.arcColor)
    .pointColor(() => t.dotColor)
    .globeMaterial().color.set(t.ocean)
  globe.atmosphereColor(t.atmosphere)
})

// --- Camera position centered on flights ---
function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

const cameraPosition = computed<[number, number, number]>(() => {
  const positions: Vector3[] = []

  for (const flight of props.flights) {
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (!code) continue
      const coords = getAirportCoordinates(code)
      if (!coords) continue
      positions.push(latLngToVector3(coords.lat, coords.lng, GLOBE_RADIUS))
    }
  }

  if (positions.length === 0) return [0, 0, 5]

  const center = new Vector3()
  for (const pos of positions) center.add(pos)
  center.divideScalar(positions.length)

  const dir = center.normalize().multiplyScalar(5)
  return [dir.x, dir.y, dir.z]
})

// --- Summary ---
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

        <primitive :object="globe" />
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 text-center">
      <span class="font-display text-xs tracking-wide text-sand-500">{{ summaryText }}</span>
    </div>
  </div>
</template>
