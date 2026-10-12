<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  Vector3,
  Group,
  MeshBasicMaterial,
  SphereGeometry,
  Mesh,
  CatmullRomCurve3,
  TubeGeometry,
  Color,
  CanvasTexture,
  SRGBColorSpace,
  RepeatWrapping,
  ClampToEdgeWrapping,
} from "three"
import type { Mesh as ThreeMesh } from "three"
import { getAirportCoordinates } from "../utils/airport-coordinates"
import { iataToCountry } from "../utils/iata-to-country"
import { drawFlatWorld } from "../utils/flat-world"
import { mapPalette } from "../utils/map-palette"
import { greatCircleArc } from "../utils/globe-arc"
import { getCountryFeatures, latLngToVector3 } from "../utils/globe-countries"

interface Flight {
  departureAirport: string | null
  arrivalAirport: string | null
  [key: string]: unknown
}

const props = defineProps<{
  flights: Flight[]
}>()

// Globe radius (kept at the previous FBX globe's scale so flight-arc math is unchanged)
const GLOBE_RADIUS = 6.414
// Arcs and dots ride just above the surface.
const SURFACE_RADIUS = GLOBE_RADIUS + 0.02

const { isDark } = useDarkMode()
const prefersReducedMotion = useReducedMotion()

const clearColor = computed(() => (isDark.value ? "#1f2023" : "#f8f9fa"))
const palette = computed(() => mapPalette(isDark.value))

const countries = getCountryFeatures()
const TEX_WIDTH = 4096
const TEX_HEIGHT = 2048

// --- Build flight arcs and airport dots ---
function buildFlightOverlays(): Group {
  const group = new Group()
  const arcMaterial = new MeshBasicMaterial({
    color: new Color(palette.value.route),
    toneMapped: false,
  })
  const dotMaterial = new MeshBasicMaterial({
    color: new Color(palette.value.route),
    toneMapped: false,
  })

  const dotGeo = new SphereGeometry(0.12, 16, 16)
  const seen = new Set<string>()

  for (const flight of props.flights) {
    if (!flight.departureAirport || !flight.arrivalAirport) continue

    const depCoords = getAirportCoordinates(flight.departureAirport)
    const arrCoords = getAirportCoordinates(flight.arrivalAirport)
    if (!depCoords || !arrCoords) continue

    // A tube, not a Line: WebGL lines are always 1px, too faint for a route.
    const curve = new CatmullRomCurve3(greatCircleArc(depCoords, arrCoords, SURFACE_RADIUS, 64))
    group.add(new Mesh(new TubeGeometry(curve, 96, 0.035, 8, false), arcMaterial))

    // Airport dots
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (seen.has(code)) continue
      seen.add(code)
      const coords = getAirportCoordinates(code)
      if (!coords) continue
      const pos = latLngToVector3(coords.lat, coords.lng, SURFACE_RADIUS)
      const dot = new Mesh(dotGeo, dotMaterial)
      dot.position.set(pos.x, pos.y, pos.z)
      group.add(dot)
    }
  }

  return group
}

// --- Scene group (globe + flight overlays) ---
const sceneGroup = shallowRef<Group | null>(null)
let flightOverlays: Group | null = null
let mapCanvas: HTMLCanvasElement | null = null
let mapTexture: CanvasTexture | null = null

function paintGlobe() {
  if (!mapCanvas) return
  drawFlatWorld(mapCanvas.getContext("2d")!, TEX_WIDTH, TEX_HEIGHT, countries, palette.value)
  if (mapTexture) mapTexture.needsUpdate = true
}

onMounted(() => {
  // A flat Google-style map, unlit and not tone-mapped so its colours match the 2D maps.
  mapCanvas = document.createElement("canvas")
  mapCanvas.width = TEX_WIDTH
  mapCanvas.height = TEX_HEIGHT
  paintGlobe()
  mapTexture = new CanvasTexture(mapCanvas)
  mapTexture.colorSpace = SRGBColorSpace
  mapTexture.wrapS = RepeatWrapping
  mapTexture.wrapT = ClampToEdgeWrapping
  mapTexture.anisotropy = 4
  const globeMat = new MeshBasicMaterial({ map: mapTexture, toneMapped: false })
  const globe = new Mesh(new SphereGeometry(GLOBE_RADIUS, 128, 128), globeMat)

  const group = new Group()
  group.add(globe)

  // Add flight arcs/dots
  flightOverlays = buildFlightOverlays()
  group.add(flightOverlays)

  sceneGroup.value = group
})

// Rebuild flight overlays when flights change
watch(
  () => props.flights,
  () => {
    if (!sceneGroup.value || !flightOverlays) return
    sceneGroup.value.remove(flightOverlays)
    flightOverlays = buildFlightOverlays()
    sceneGroup.value.add(flightOverlays)
  },
)

// Repaint the map and recolour routes on theme change
watch(palette, (p) => {
  paintGlobe()
  flightOverlays?.traverse((child) => {
    if ((child as ThreeMesh).isMesh) {
      ;((child as ThreeMesh).material as MeshBasicMaterial).color.set(p.route)
    }
  })
})

// --- Camera position centered on flights ---
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

  if (positions.length === 0) return [0, 0, 20]

  const center = new Vector3()
  for (const pos of positions) center.add(pos)
  center.divideScalar(positions.length)

  const dir = center.normalize().multiplyScalar(20)
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
  <div
    class="relative h-[300px] w-full overflow-hidden rounded-2xl border border-sand-200 sm:h-[450px]"
  >
    <ClientOnly>
      <TresCanvas :alpha="true" :clear-color="clearColor" :antialias="true">
        <TresPerspectiveCamera :position="cameraPosition" :fov="45" />

        <OrbitControls
          :enable-zoom="true"
          :enable-pan="false"
          :auto-rotate="!prefersReducedMotion"
          :auto-rotate-speed="0.3"
          :min-distance="12"
          :max-distance="35"
          :min-polar-angle="0.5"
          :max-polar-angle="2.6"
          :rotate-speed="0.4"
          :zoom-speed="0.6"
          :enable-damping="true"
        />

        <primitive v-if="sceneGroup" :object="sceneGroup" />
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 flex justify-center">
      <span
        role="status"
        class="rounded-full bg-white px-3 py-1 text-xs font-medium text-sand-800 shadow-sm"
        >{{ summaryText }}</span
      >
    </div>
  </div>
</template>
