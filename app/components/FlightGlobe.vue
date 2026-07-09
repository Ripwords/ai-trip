<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  Vector3,
  Group,
  MeshBasicMaterial,
  LineBasicMaterial,
  Line,
  BufferGeometry,
  SphereGeometry,
  Mesh,
  QuadraticBezierCurve3,
  Color,
} from "three"
import type { Mesh as ThreeMesh } from "three"
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js"
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

// FBX globe: radius=6.414, centered at (4.903, 24.344, 1.078)
const FBX_CENTER = { x: 4.903, y: 24.344, z: 1.078 }
const FBX_RADIUS = 6.414

const { isDark } = useDarkMode()
const prefersReducedMotion = useReducedMotion()

const theme = computed(() =>
  isDark.value
    ? {
        clearColor: "#1a1714",
        arcColor: "#f07b5a",
        dotColor: "#f7a48a",
      }
    : {
        clearColor: "#faf8f5",
        arcColor: "#d44425",
        dotColor: "#e85d3a",
      },
)

// --- Convert lat/lng to 3D position on the FBX globe ---
function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

// --- Build flight arcs and airport dots ---
function buildFlightOverlays(): Group {
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

  const dotGeo = new SphereGeometry(0.08, 12, 12)
  const seen = new Set<string>()

  for (const flight of props.flights) {
    if (!flight.departureAirport || !flight.arrivalAirport) continue

    const depCoords = getAirportCoordinates(flight.departureAirport)
    const arrCoords = getAirportCoordinates(flight.arrivalAirport)
    if (!depCoords || !arrCoords) continue

    const start = latLngToVector3(depCoords.lat, depCoords.lng, FBX_RADIUS * 1.002)
    const end = latLngToVector3(arrCoords.lat, arrCoords.lng, FBX_RADIUS * 1.002)

    // Arc: quadratic bezier elevated above the globe
    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5)
    const distance = start.distanceTo(end)
    const arcHeight = FBX_RADIUS + 0.5 + distance * 0.15
    const midElevated = mid.normalize().multiplyScalar(arcHeight)

    const curve = new QuadraticBezierCurve3(start, midElevated, end)
    const points = curve.getPoints(64)
    const arcGeo = new BufferGeometry().setFromPoints(points)
    group.add(new Line(arcGeo, arcMaterial))

    // Airport dots
    for (const code of [flight.departureAirport, flight.arrivalAirport]) {
      if (seen.has(code)) continue
      seen.add(code)
      const coords = getAirportCoordinates(code)
      if (!coords) continue
      const pos = latLngToVector3(coords.lat, coords.lng, FBX_RADIUS * 1.003)
      const dot = new Mesh(dotGeo, dotMaterial)
      dot.position.set(pos.x, pos.y, pos.z)
      group.add(dot)
    }
  }

  return group
}

// --- Scene group (FBX model + flight overlays) ---
const sceneGroup = shallowRef<Group | null>(null)
let flightOverlays: Group | null = null

onMounted(async () => {
  const loader = new FBXLoader()
  const fbx = await loader.loadAsync("/models/earth.fbx")
  fbx.position.set(-FBX_CENTER.x, -FBX_CENTER.y, -FBX_CENTER.z)

  // Convert to unlit material so the globe is fully visible from all angles
  fbx.traverse((child) => {
    const mesh = child as ThreeMesh
    if (mesh.isMesh && mesh.material) {
      const oldMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      mesh.material = new MeshBasicMaterial({
        map: (oldMat as { map?: unknown }).map ?? null,
      })
    }
  })

  const group = new Group()
  group.add(fbx)

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

// Update arc/dot colors on theme change
watch(theme, (t) => {
  if (!flightOverlays) return
  flightOverlays.traverse((child) => {
    if ((child as Line).isLine) {
      ;((child as Line).material as LineBasicMaterial).color.set(t.arcColor)
    }
    if ((child as ThreeMesh).isMesh && (child as ThreeMesh).geometry.type === "SphereGeometry") {
      ;((child as ThreeMesh).material as MeshBasicMaterial).color.set(t.dotColor)
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
      positions.push(latLngToVector3(coords.lat, coords.lng, FBX_RADIUS))
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
      <TresCanvas :alpha="true" :clear-color="theme.clearColor" :antialias="true">
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
          :enable-damping="true"
        />

        <primitive v-if="sceneGroup" :object="sceneGroup" />
      </TresCanvas>
    </ClientOnly>

    <!-- Summary overlay -->
    <div class="absolute bottom-3 left-0 right-0 flex justify-center">
      <span
        role="status"
        class="rounded-full bg-white/70 px-3 py-1 font-display text-xs tracking-wide text-sand-800 backdrop-blur-sm"
        >{{ summaryText }}</span
      >
    </div>
  </div>
</template>
