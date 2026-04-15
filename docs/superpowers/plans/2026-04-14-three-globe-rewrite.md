# Three-Globe Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace equirectangular texture globe rendering with three-globe library for distortion-free 3D polygon geometry on both GlobeScratchMap and FlightGlobe.

**Architecture:** Shared utility `globe-renderer.ts` creates ThreeGlobe instances. Both components consume it, passing color accessors and data. Click detection uses raycasting against three-globe's polygon meshes instead of UV texture sampling.

**Tech Stack:** three-globe, Three.js 0.170, TresJS 5.6, Nuxt, Vue 3, topojson-client

**Spec:** `docs/superpowers/specs/2026-04-14-three-globe-rewrite-design.md`

---

## File Structure

| Action  | File                                 | Responsibility                                                                                      |
| ------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Create  | `app/utils/globe-renderer.ts`        | Shared factory: creates ThreeGlobe, configures polygons, exports country-from-mesh helper           |
| Modify  | `app/utils/globe-countries.ts`       | Remove texture rendering, keep `latLngToVector3`, `getCountryCentroid`, `getCountryFeatures`, types |
| Rewrite | `app/components/GlobeScratchMap.vue` | Interactive globe using three-globe, manual raycasting for click/hover                              |
| Rewrite | `app/components/FlightGlobe.vue`     | Flight route globe using three-globe arcs/points                                                    |

---

### Task 1: Install three-globe

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install three-globe
```

- [ ] **Step 2: Verify it installed correctly**

```bash
node -e "require('three-globe'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add three-globe dependency"
```

---

### Task 2: Create shared globe renderer utility

**Files:**

- Create: `app/utils/globe-renderer.ts`

- [ ] **Step 1: Create the globe renderer utility**

```ts
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
    .polygonAltitude(0.006)

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
```

- [ ] **Step 2: Verify the file has no type errors**

```bash
npx vue-tsc --noEmit 2>&1 | grep globe-renderer || echo "No errors"
```

Expected: `No errors`

- [ ] **Step 3: Commit**

```bash
git add app/utils/globe-renderer.ts
git commit -m "feat: add shared three-globe renderer utility"
```

---

### Task 3: Clean up globe-countries.ts

Remove texture rendering code, keep utilities needed by both components.

**Files:**

- Modify: `app/utils/globe-countries.ts`

- [ ] **Step 1: Rewrite globe-countries.ts to keep only utilities**

Replace the entire file with:

```ts
import { Vector3 } from "three"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
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

/**
 * Compute the centroid of a country (average lat/lng of polygon vertices).
 */
export function getCountryCentroid(feat: CountryGeoFeature): { lat: number; lng: number } {
  const geo = feat.geoFeature.geometry
  const coords =
    geo.type === "Polygon" ? [geo.coordinates] : geo.type === "MultiPolygon" ? geo.coordinates : []

  let totalLat = 0
  let totalLng = 0
  let count = 0

  for (const polygon of coords) {
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
```

- [ ] **Step 2: Check for broken imports across the project**

```bash
grep -r "renderGlobeTexture\|renderIdTexture\|resolveCountryFromUV\|getFeatureAvgLat\|GlobeColors" app/ --include="*.vue" --include="*.ts" -l
```

Expected: Only `GlobeScratchMap.vue` and possibly `globe-countries.ts` itself (which we're rewriting in the next task).

- [ ] **Step 3: Commit**

```bash
git add app/utils/globe-countries.ts
git commit -m "refactor: remove texture rendering from globe-countries, keep utilities"
```

---

### Task 4: Rewrite GlobeScratchMap.vue

**Files:**

- Rewrite: `app/components/GlobeScratchMap.vue`

- [ ] **Step 1: Rewrite the full component**

```vue
<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import { Raycaster, Vector2 } from "three"
import {
  createGlobe,
  getCountryFromMesh,
  type EnrichedFeature,
  type GlobeTheme,
} from "../utils/globe-renderer"
import {
  getCountryFeatures,
  getCountryCentroid,
  latLngToVector3,
  GLOBE_RADIUS,
  type VisitType,
} from "../utils/globe-countries"
import type { CountryInfo } from "../data/countries"

const props = defineProps<{
  visitMap: Map<string, VisitType>
  visaStatusMap: Record<string, { visaStatus: string; maxStayDays: number | null }>
}>()

const emit = defineEmits<{
  countryClick: [country: CountryInfo]
  toggleView: []
}>()

const { isDark } = useDarkMode()

// --- Theme ---
const theme = computed<
  GlobeTheme & {
    visitedColor: string
    layoverColor: string
    wantColor: string
    unvisitedColor: string
  }
>(() =>
  isDark.value
    ? {
        clearColor: "#1a1714",
        ocean: "#1e1b16",
        atmosphere: "#e85d3a",
        atmosphereOpacity: 0.04,
        ambientIntensity: 0.5,
        directionalIntensity: 0.9,
        border: "#4a8450",
        visitedColor: "#f07b5a",
        layoverColor: "#4aa5b9",
        wantColor: "#a78bfa",
        unvisitedColor: "#302b24",
      }
    : {
        clearColor: "#faf8f5",
        ocean: "#d9eef3",
        atmosphere: "#7dc3d4",
        atmosphereOpacity: 0.06,
        ambientIntensity: 0.9,
        directionalIntensity: 1.4,
        border: "#3a6a3f",
        visitedColor: "#f07b5a",
        layoverColor: "#4aa5b9",
        wantColor: "#a78bfa",
        unvisitedColor: "#e8e0d4",
      },
)

// --- Globe instance ---
function getPolygonColor(feat: EnrichedFeature): string {
  const alpha2 = feat.properties.alpha2
  const visitType = alpha2 ? props.visitMap.get(alpha2) : undefined
  const t = theme.value
  if (visitType === "visited") return t.visitedColor
  if (visitType === "layover") return t.layoverColor
  if (visitType === "want_to_visit") return t.wantColor
  return t.unvisitedColor
}

const globe = createGlobe({
  theme: theme.value,
  polygonCapColor: getPolygonColor,
})

// Reactively update colors when visitMap or theme changes
watch([() => props.visitMap, theme], () => {
  globe
    .polygonCapColor(getPolygonColor as (obj: object) => string)
    .polygonStrokeColor(() => theme.value.border)
    .globeMaterial()
    .color.set(theme.value.ocean)
  globe.atmosphereColor(theme.value.atmosphere)
})

// --- Stats ---
const visitedCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "visited").length,
)
const layoverCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "layover").length,
)
const wantCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "want_to_visit").length,
)

// --- Tooltip ---
const isTouch = ref(false)
onMounted(() => {
  isTouch.value = window.matchMedia("(pointer: coarse)").matches
})

const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)
const tooltipCountry = ref<CountryInfo | null>(null)
const tooltipVisitType = ref<VisitType | null>(null)

const tooltipVisa = computed(() => {
  if (!tooltipCountry.value) return null
  const status = props.visaStatusMap[tooltipCountry.value.alpha2]
  if (!status) return null
  const config: Record<string, { label: string; colorClass: string }> = {
    "visa-free": { label: "Visa Free", colorClass: "bg-green-500/20 text-green-700" },
    "visa-on-arrival": { label: "On Arrival", colorClass: "bg-blue-500/20 text-blue-700" },
    evisa: { label: "e-Visa", colorClass: "bg-amber-500/20 text-amber-700" },
    "visa-required": { label: "Visa Required", colorClass: "bg-red-500/20 text-red-700" },
  }
  const c = config[status.visaStatus]
  if (!c) return null
  return { ...c, maxStayDays: status.maxStayDays }
})

// --- Manual raycasting ---
const containerRef = ref<HTMLElement | null>(null)
const controlsRef = ref()
const raycaster = new Raycaster()
const pointer = new Vector2()

function getControls() {
  const instanceRef = controlsRef.value?.instance
  return instanceRef?.value ?? instanceRef
}

function raycastCountry(event: MouseEvent): CountryInfo | undefined {
  const canvas = containerRef.value?.querySelector("canvas")
  const controls = getControls()
  if (!canvas || !controls?.object) return undefined

  const rect = canvas.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, controls.object)
  const hits = raycaster.intersectObjects(globe.children, true)
  if (!hits.length) return undefined

  return getCountryFromMesh(hits[0]!.object as { __data?: EnrichedFeature; parent?: unknown })
}

let pointerDownX = 0
let pointerDownY = 0

function onPointerDown(event: PointerEvent) {
  pointerDownX = event.clientX
  pointerDownY = event.clientY
}

function onCanvasClick(event: MouseEvent) {
  const dx = event.clientX - pointerDownX
  const dy = event.clientY - pointerDownY
  if (dx * dx + dy * dy > 25) return

  const info = raycastCountry(event)
  if (info) {
    emit("countryClick", info)
    animateToCentroid(info)
  }
}

function onCanvasPointerMove(event: PointerEvent) {
  if (isTouch.value) {
    tooltipVisible.value = false
    return
  }
  const info = raycastCountry(event)
  if (info) {
    tooltipCountry.value = info
    tooltipVisitType.value = props.visitMap.get(info.alpha2) ?? null
    tooltipX.value = event.clientX
    tooltipY.value = event.clientY
    tooltipVisible.value = true
  } else {
    tooltipVisible.value = false
    tooltipCountry.value = null
  }
}

function onCanvasPointerLeave() {
  tooltipVisible.value = false
  tooltipCountry.value = null
}

// --- Canvas listener attachment ---
let attachedCanvas: HTMLCanvasElement | null = null

function attachCanvasListeners(canvas: HTMLCanvasElement) {
  if (attachedCanvas === canvas) return
  detachCanvasListeners()
  attachedCanvas = canvas
  canvas.addEventListener("pointerdown", onPointerDown)
  canvas.addEventListener("click", onCanvasClick)
  canvas.addEventListener("pointermove", onCanvasPointerMove)
  canvas.addEventListener("pointerleave", onCanvasPointerLeave)
}

function detachCanvasListeners() {
  if (!attachedCanvas) return
  attachedCanvas.removeEventListener("pointerdown", onPointerDown)
  attachedCanvas.removeEventListener("click", onCanvasClick)
  attachedCanvas.removeEventListener("pointermove", onCanvasPointerMove)
  attachedCanvas.removeEventListener("pointerleave", onCanvasPointerLeave)
  attachedCanvas = null
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  const existing = container.querySelector("canvas")
  if (existing) {
    attachCanvasListeners(existing)
    return
  }

  const observer = new MutationObserver(() => {
    const canvas = container.querySelector("canvas")
    if (canvas) {
      attachCanvasListeners(canvas)
      observer.disconnect()
    }
  })
  observer.observe(container, { childList: true, subtree: true })
})

onUnmounted(() => {
  detachCanvasListeners()
})

// --- Auto-center animation ---
const allFeatures = getCountryFeatures()

function animateToCentroid(info: CountryInfo) {
  const feat = allFeatures.find((f) => f.info?.alpha2 === info.alpha2)
  if (!feat) return

  const centroid = getCountryCentroid(feat)
  const target = latLngToVector3(centroid.lat, centroid.lng, 0)
  const cameraTarget = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS)
    .normalize()
    .multiplyScalar(5)

  const controls = getControls()
  if (!controls) return

  const startTarget = controls.target.clone()
  const startPos = controls.object.position.clone()
  const duration = 500
  const startTime = Date.now()

  function animate() {
    const elapsed = Date.now() - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = t * (2 - t)

    controls.target.lerpVectors(startTarget, target, ease)
    controls.object.position.lerpVectors(startPos, cameraTarget, ease)
    controls.update()

    if (t < 1) requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative h-[500px] w-full overflow-hidden rounded-2xl border border-sand-200 sm:h-[600px]"
  >
    <ClientOnly>
      <TresCanvas :alpha="true" :clear-color="theme.clearColor" :antialias="true">
        <TresPerspectiveCamera :position="[0, 0, 5]" :fov="45" />

        <TresAmbientLight :intensity="theme.ambientIntensity" />
        <TresDirectionalLight :position="[5, 3, 5]" :intensity="theme.directionalIntensity" />

        <OrbitControls
          ref="controlsRef"
          :enable-zoom="true"
          :enable-pan="false"
          :auto-rotate="false"
          :min-distance="3"
          :max-distance="8"
          :enable-damping="true"
        />

        <primitive :object="globe" />
      </TresCanvas>
    </ClientOnly>

    <!-- Tooltip (desktop only) -->
    <div
      v-if="tooltipVisible && tooltipCountry && !isTouch"
      class="pointer-events-none fixed z-50 rounded-lg bg-sand-900/90 px-3 py-2 text-xs text-sand-100 shadow-lg backdrop-blur-sm"
      :style="{ left: tooltipX + 12 + 'px', top: tooltipY - 10 + 'px' }"
    >
      <p class="font-semibold">{{ tooltipCountry.name }}</p>
      <p v-if="tooltipVisitType" class="mt-0.5 text-sand-400">
        {{
          tooltipVisitType === "visited"
            ? "Visited"
            : tooltipVisitType === "layover"
              ? "Layover"
              : "Want to visit"
        }}
      </p>
      <div v-if="tooltipVisa" class="mt-1">
        <span
          class="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
          :class="tooltipVisa.colorClass"
        >
          {{ tooltipVisa.label }}
          <template v-if="tooltipVisa.maxStayDays">({{ tooltipVisa.maxStayDays }}d)</template>
        </span>
      </div>
    </div>

    <!-- Controls: view toggle -->
    <div class="absolute right-3 top-3 flex flex-col gap-1.5">
      <button
        class="map-btn flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        title="Switch to 2D map"
        @click="emit('toggleView')"
      >
        <Icon name="lucide:map" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
    </div>

    <!-- Stats overlay -->
    <div
      class="map-overlay map-overlay-border absolute bottom-3 left-3 rounded-xl px-3 py-1.5 backdrop-blur-sm"
    >
      <p class="map-overlay-text text-sm font-medium">
        <span class="map-overlay-accent text-lg font-bold">{{ visitedCount }}</span>
        visited
        <template v-if="layoverCount">
          <span class="mx-1 opacity-40">&middot;</span>
          <span class="map-layover-accent text-lg font-bold">{{ layoverCount }}</span>
          layover
        </template>
        <template v-if="wantCount">
          <span class="mx-1 opacity-40">&middot;</span>
          <span class="map-want-accent text-lg font-bold">{{ wantCount }}</span>
          wishlist
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.map-btn {
  background: var(--color-sand-50);
  color: var(--color-sand-700);
}
.map-btn:hover {
  background: var(--color-sand-200);
}
.map-overlay {
  background: var(--color-sand-50);
}
.map-overlay-border {
  border: 1px solid var(--color-sand-200);
}
.map-overlay-text {
  color: var(--color-sand-600);
}
.map-overlay-accent {
  color: var(--color-terra-500);
}
.map-layover-accent {
  color: var(--color-ocean-500);
}
.map-want-accent {
  color: #a78bfa;
}
</style>
```

- [ ] **Step 2: Verify dev server starts without errors**

```bash
npx nuxi dev 2>&1 | head -30
```

Expected: No import errors. Server starts.

- [ ] **Step 3: Test in browser**

Open the explore page, switch to 3D globe view. Verify:

- Globe renders with countries visible (no equirectangular distortion)
- Hover shows tooltips with country names
- Click opens the country detail panel
- Dark/light mode switching updates colors
- Zoom in on poles — no distortion artifacts

- [ ] **Step 4: Commit**

```bash
git add app/components/GlobeScratchMap.vue
git commit -m "feat: rewrite GlobeScratchMap with three-globe for distortion-free rendering"
```

---

### Task 5: Rewrite FlightGlobe.vue

**Files:**

- Rewrite: `app/components/FlightGlobe.vue`

- [ ] **Step 1: Rewrite the full component**

```vue
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
    .globeMaterial()
    .color.set(t.ocean)
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
```

- [ ] **Step 2: Test in browser**

Navigate to a trip page that has flights. Verify:

- Globe renders with filled country polygons (no more wireframe-only borders)
- Flight arcs display between airports
- Airport dots visible
- Auto-rotation works
- Camera centers on the flight routes
- Dark/light mode switching updates all colors
- Summary text shows correct flight/country counts

- [ ] **Step 3: Commit**

```bash
git add app/components/FlightGlobe.vue
git commit -m "feat: rewrite FlightGlobe with three-globe for distortion-free rendering"
```

---

### Task 6: Verify and adjust

- [ ] **Step 1: Test both globes end-to-end**

Check all these in the browser:

1. Explore page → 3D globe: countries colored by visit status, click opens panel, hover shows tooltip, zoom to poles shows no distortion
2. Trip page → FlightGlobe: arcs render, dots render, auto-rotate works, summary text correct
3. Toggle dark/light mode on both pages — all colors update
4. Switch between 2D and 3D views on explore page — no errors

- [ ] **Step 2: Fix any issues found**

Adjust three-globe configuration as needed (polygon altitude, stroke width, arc styling, atmosphere intensity, etc.) based on visual testing.

- [ ] **Step 3: Final commit if adjustments made**

```bash
git add -u
git commit -m "fix: adjust three-globe visual tuning after testing"
```

---

### Task 7: Clean up unused dependencies

- [ ] **Step 1: Check if d3-geo is still used anywhere**

```bash
grep -r "d3-geo\|geoEquirectangular\|geoNaturalEarth1\|geoPath" app/ --include="*.vue" --include="*.ts" -l
```

If only used in `ScratchMap.vue` (the 2D map), that's fine — keep it. If unused entirely, remove from package.json.

- [ ] **Step 2: Check for other unused imports**

```bash
grep -r "CanvasTexture\|SRGBColorSpace" app/utils/globe-countries.ts
```

Expected: No matches (these were only used by the deleted texture functions).

- [ ] **Step 3: Commit cleanup if needed**

```bash
git add -u
git commit -m "chore: remove unused imports from globe utilities"
```
