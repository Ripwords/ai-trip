# Globe Scratch Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive 3D globe view to the explore page with clickable country meshes, as an alternative to the existing 2D scratch map.

**Architecture:** Countries from TopoJSON are triangulated onto a sphere using `earcut`, with each country as a clickable mesh colored by visit status. Unvisited countries are merged into a single mesh with a face-to-country lookup for click resolution. The globe and 2D map share the same props/events interface, so `explore.vue` just swaps between them via a toggle.

**Tech Stack:** TresJS (`@tresjs/core`, `@tresjs/cientos`), Three.js, earcut, d3-geo, topojson-client

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/utils/globe-countries.ts` | Triangulate GeoJSON countries onto sphere, build merged/individual geometries, face-to-country lookup |
| `app/components/GlobeScratchMap.vue` | TresJS 3D globe with clickable country meshes, hover tooltips, controls |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `earcut`, `@types/earcut` |
| `app/components/ScratchMap.vue` | Add globe toggle button to controls, emit `toggleView` |
| `app/pages/explore.vue` | Add `viewMode` state, conditionally render ScratchMap vs GlobeScratchMap |

---

## Task 1: Install earcut

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install earcut and types**

```bash
bun add earcut
bun add -d @types/earcut
```

- [ ] **Step 2: Verify dev server starts**

```bash
bun run dev
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add earcut for polygon triangulation"
```

---

## Task 2: Globe Countries Utility

**Files:**
- Create: `app/utils/globe-countries.ts`

- [ ] **Step 1: Create the triangulation utility**

This file takes GeoJSON country features and produces Three.js geometries for a globe. It handles:
- Converting lat/lng polygons to 3D sphere vertices
- Triangulating polygons with `earcut`
- Building merged geometry for unvisited countries with face-to-country lookup
- Building individual geometries for marked countries

```ts
import earcut from "earcut"
import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
} from "three"
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

export interface CountryGeoFeature {
  id: string
  info: CountryInfo | undefined
  rings: number[][][] // array of polygon rings, each ring is [[lng, lat], ...]
}

/** Extract all country features with their polygon rings */
export function getCountryFeatures(): CountryGeoFeature[] {
  const features: CountryGeoFeature[] = []

  for (const feat of countriesGeo.features) {
    const numericId = String(feat.id).padStart(3, "0")
    const info = countryByNumeric.get(numericId)

    const polygons =
      feat.geometry.type === "Polygon"
        ? [feat.geometry.coordinates]
        : feat.geometry.type === "MultiPolygon"
          ? feat.geometry.coordinates
          : []

    const rings: number[][][] = []
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (ring.length >= 3) {
          rings.push(ring as number[][])
        }
      }
    }

    if (rings.length > 0) {
      features.push({ id: numericId, info, rings })
    }
  }

  return features
}

/**
 * Triangulate a single polygon ring onto the sphere surface.
 * Returns vertices (flat array of x,y,z) and indices.
 */
function triangulateRing(
  ring: number[][],
  radius: number,
): { vertices: number[]; indices: number[] } {
  // Project to 2D for earcut (use lng/lat directly — earcut works in 2D)
  const flatCoords: number[] = []
  for (const [lng, lat] of ring) {
    flatCoords.push(lng!, lat!)
  }

  const triIndices = earcut(flatCoords, undefined, 2)

  // Build 3D vertices on sphere
  const vertices: number[] = []
  for (const [lng, lat] of ring) {
    const v = latLngToVector3(lat!, lng!, radius)
    vertices.push(v.x, v.y, v.z)
  }

  return { vertices, indices: triIndices }
}

/**
 * Build a BufferGeometry for a single country (all its rings merged).
 */
export function buildCountryGeometry(countryFeature: CountryGeoFeature): BufferGeometry {
  const allVertices: number[] = []
  const allIndices: number[] = []
  let vertexOffset = 0

  for (const ring of countryFeature.rings) {
    const { vertices, indices } = triangulateRing(ring, GLOBE_RADIUS * 1.001)
    allVertices.push(...vertices)
    for (const idx of indices) {
      allIndices.push(idx + vertexOffset)
    }
    vertexOffset += ring.length
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
    for (const ring of countryFeature.rings) {
      const { vertices, indices } = triangulateRing(ring, GLOBE_RADIUS * 1.001)
      allVertices.push(...vertices)
      for (let i = 0; i < indices.length; i += 3) {
        allIndices.push(
          indices[i]! + vertexOffset,
          indices[i + 1]! + vertexOffset,
          indices[i + 2]! + vertexOffset,
        )
        faceToCountryId.push(countryFeature.id)
      }
      vertexOffset += ring.length
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
 * Compute the centroid of a country (average lat/lng of all ring vertices).
 */
export function getCountryCentroid(
  countryFeature: CountryGeoFeature,
): { lat: number; lng: number } {
  let totalLat = 0
  let totalLng = 0
  let count = 0

  for (const ring of countryFeature.rings) {
    for (const [lng, lat] of ring) {
      totalLat += lat!
      totalLng += lng!
      count++
    }
  }

  return { lat: totalLat / count, lng: totalLng / count }
}
```

- [ ] **Step 2: Verify dev server starts**

```bash
bun run dev
```

Expected: No errors. The file is a utility — it just needs to parse.

- [ ] **Step 3: Commit**

```bash
git add app/utils/globe-countries.ts
git commit -m "feat: add globe country triangulation utility"
```

---

## Task 3: GlobeScratchMap Component

**Files:**
- Create: `app/components/GlobeScratchMap.vue`

This is the most complex task. The component renders a TresJS globe with:
- Filled country meshes colored by visit status
- Click detection on all countries (individual meshes + merged mesh)
- Hover tooltips (desktop only)
- Orbit controls with zoom
- Auto-center on click
- Stats overlay, fullscreen toggle, view toggle button
- Light/dark theme support

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { OrbitControls } from "@tresjs/cientos"
import {
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshPhongMaterial,
  Mesh,
  Color,
  Vector3,
  Raycaster,
  Vector2,
} from "three"
import {
  getCountryFeatures,
  buildCountryGeometry,
  buildMergedGeometry,
  buildBorderLines,
  getCountryCentroid,
  latLngToVector3,
  GLOBE_RADIUS,
  type CountryGeoFeature,
  type MergedCountryResult,
} from "../utils/globe-countries"
import { countryByNumeric, type CountryInfo } from "../data/countries"

export type VisitType = "visited" | "layover" | "want_to_visit"

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
const theme = computed(() =>
  isDark.value
    ? {
        clearColor: "#1a1714",
        ocean: "#1e1b16",
        oceanEmissive: "#15120e",
        atmosphere: "#e85d3a",
        atmosphereOpacity: 0.04,
        borderColor: "#4a8450",
        borderOpacity: 0.35,
        visited: "#f07b5a",
        layover: "#4aa5b9",
        want: "#a78bfa",
        unvisited: "#302b24",
        unvisitedEmissive: "#1a1714",
        hoverEmissive: "#555555",
        ambientIntensity: 0.5,
        directionalIntensity: 0.9,
      }
    : {
        clearColor: "#faf8f5",
        ocean: "#d9eef3",
        oceanEmissive: "#b3dde7",
        atmosphere: "#7dc3d4",
        atmosphereOpacity: 0.06,
        borderColor: "#3a6a3f",
        borderOpacity: 0.5,
        visited: "#f07b5a",
        layover: "#4aa5b9",
        want: "#a78bfa",
        unvisited: "#e8e0d4",
        unvisitedEmissive: "#d4c8b8",
        hoverEmissive: "#aaaaaa",
        ambientIntensity: 0.9,
        directionalIntensity: 1.4,
      },
)

// --- Country data (computed once) ---
const allFeatures = getCountryFeatures()
const featureById = new Map<string, CountryGeoFeature>()
for (const f of allFeatures) {
  featureById.set(f.id, f)
}

// --- Categorize countries by visit status ---
function getVisitTypeForFeature(feat: CountryGeoFeature): VisitType | null {
  if (!feat.info) return null
  return props.visitMap.get(feat.info.alpha2) ?? null
}

// --- Build meshes reactively ---
interface MarkedCountryMesh {
  mesh: Mesh
  feature: CountryGeoFeature
  visitType: VisitType
}

const markedMeshes = computed<MarkedCountryMesh[]>(() => {
  const t = theme.value
  const meshes: MarkedCountryMesh[] = []

  for (const feat of allFeatures) {
    const visitType = getVisitTypeForFeature(feat)
    if (!visitType) continue

    const color =
      visitType === "visited" ? t.visited : visitType === "layover" ? t.layover : t.want
    const material = new MeshPhongMaterial({
      color: new Color(color),
      shininess: 20,
    })
    const geometry = buildCountryGeometry(feat)
    const mesh = new Mesh(geometry, material)
    mesh.userData = { countryId: feat.id, visitType }
    meshes.push({ mesh, feature: feat, visitType })
  }

  return meshes
})

const mergedResult = computed<MergedCountryResult>(() => {
  const unvisited = allFeatures.filter((f) => !getVisitTypeForFeature(f))
  return buildMergedGeometry(unvisited)
})

const mergedMaterial = computed(
  () =>
    new MeshPhongMaterial({
      color: new Color(theme.value.unvisited),
      emissive: new Color(theme.value.unvisitedEmissive),
      shininess: 10,
    }),
)

const mergedMesh = computed(() => {
  const mesh = new Mesh(mergedResult.value.geometry, mergedMaterial.value)
  mesh.userData = { isMerged: true }
  return mesh
})

// --- Borders ---
const borderGeometry = buildBorderLines()
const borderMaterial = computed(
  () =>
    new LineBasicMaterial({
      color: new Color(theme.value.borderColor),
      transparent: true,
      opacity: theme.value.borderOpacity,
    }),
)
const borderLines = computed(() => new LineSegments(borderGeometry, borderMaterial.value))

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

// --- Tooltip (desktop only) ---
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
    "visa-free": { label: "Visa Free", colorClass: "bg-green-500/20 text-green-400" },
    "visa-on-arrival": { label: "On Arrival", colorClass: "bg-blue-500/20 text-blue-400" },
    evisa: { label: "e-Visa", colorClass: "bg-amber-500/20 text-amber-400" },
    "visa-required": { label: "Visa Required", colorClass: "bg-red-500/20 text-red-400" },
  }
  const c = config[status.visaStatus]
  if (!c) return null
  return { ...c, maxStayDays: status.maxStayDays }
})

function resolveCountryFromMergedFace(faceIndex: number): CountryInfo | undefined {
  const countryId = mergedResult.value.faceToCountryId[faceIndex]
  if (!countryId) return undefined
  const feat = featureById.get(countryId)
  return feat?.info
}

function handleCountryPointerOver(info: CountryInfo, event: PointerEvent) {
  if (isTouch.value) return
  tooltipCountry.value = info
  tooltipVisitType.value = props.visitMap.get(info.alpha2) ?? null
  tooltipX.value = event.clientX
  tooltipY.value = event.clientY
  tooltipVisible.value = true
}

function handleCountryPointerOut() {
  tooltipVisible.value = false
  tooltipCountry.value = null
}

function handlePointerMove(event: PointerEvent) {
  if (tooltipVisible.value) {
    tooltipX.value = event.clientX
    tooltipY.value = event.clientY
  }
}

// --- Click handling ---
function handleCountryClick(info: CountryInfo) {
  emit("countryClick", info)
  animateToCentroid(info)
}

// --- Auto-center animation ---
const controlsRef = ref()

function animateToCentroid(info: CountryInfo) {
  // Find the feature for this country
  const feat = allFeatures.find((f) => f.info?.alpha2 === info.alpha2)
  if (!feat) return

  const centroid = getCountryCentroid(feat)
  const target = latLngToVector3(centroid.lat, centroid.lng, 0)
  const cameraTarget = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS)
    .normalize()
    .multiplyScalar(5)

  // Simple lerp animation
  const controls = controlsRef.value?.value
  if (!controls) return

  const startTarget = controls.target.clone()
  const startPos = controls.object.position.clone()
  const duration = 500
  const startTime = Date.now()

  function animate() {
    const elapsed = Date.now() - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = t * (2 - t) // ease-out quad

    controls.target.lerpVectors(startTarget, target, ease)
    controls.object.position.lerpVectors(startPos, cameraTarget, ease)
    controls.update()

    if (t < 1) requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}

// --- Fullscreen ---
const containerRef = ref<HTMLElement>()
const isFullscreen = ref(false)

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  document.body.style.overflow = isFullscreen.value ? "hidden" : ""
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full overflow-hidden rounded-2xl border border-sand-200"
    :class="isFullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : 'h-[500px] sm:h-[600px]'"
    @pointermove="handlePointerMove"
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
        <primitive :object="borderLines" />

        <!-- Merged unvisited countries -->
        <primitive
          :object="mergedMesh"
          @click="(e: any) => {
            const info = resolveCountryFromMergedFace(e.faceIndex)
            if (info) handleCountryClick(info)
          }"
          @pointerover="(e: any) => {
            const info = resolveCountryFromMergedFace(e.faceIndex)
            if (info) handleCountryPointerOver(info, e.nativeEvent)
          }"
          @pointerout="handleCountryPointerOut"
        />

        <!-- Individual marked country meshes -->
        <primitive
          v-for="mc in markedMeshes"
          :key="mc.feature.id"
          :object="mc.mesh"
          @click="() => mc.feature.info && handleCountryClick(mc.feature.info)"
          @pointerover="(e: any) => mc.feature.info && handleCountryPointerOver(mc.feature.info, e.nativeEvent)"
          @pointerout="handleCountryPointerOut"
        />
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
        <span class="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium" :class="tooltipVisa.colorClass">
          {{ tooltipVisa.label }}
          <template v-if="tooltipVisa.maxStayDays">({{ tooltipVisa.maxStayDays }}d)</template>
        </span>
      </div>
    </div>

    <!-- Fullscreen toggle -->
    <button
      class="map-btn absolute left-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
      :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
      @click="toggleFullscreen"
    >
      <Icon
        :name="isFullscreen ? 'lucide:minimize-2' : 'lucide:maximize'"
        class="h-5 w-5 sm:h-4 sm:w-4"
      />
    </button>

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
```

**IMPORTANT notes for implementor:**

1. TresJS `@click`, `@pointerover`, `@pointerout` on `<primitive>` may not work directly depending on TresJS version. If events don't fire on `<primitive>`, the implementor should use `useRaycaster` from `@tresjs/core` or manually set up a `Raycaster` in an `onLoop` callback. Test this — if `@click` on `<primitive>` works, use it. If not, switch to manual raycasting.

2. The `map-btn`, `map-overlay`, `map-overlay-text`, `map-overlay-accent`, `map-layover-accent`, `map-want-accent`, `map-overlay-border` CSS classes are already defined in `ScratchMap.vue`'s `<style>` block. Since they're scoped, they won't apply here. The implementor should either:
   - Move those styles to `tailwind.css` as global utility classes, OR
   - Duplicate the relevant styles in `GlobeScratchMap.vue`'s own `<style>` block

   The styles are (from ScratchMap.vue):
   ```css
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
   ```

- [ ] **Step 2: Verify dev server starts and component renders**

```bash
bun run dev
```

The component won't be routed yet but should parse without errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/GlobeScratchMap.vue
git commit -m "feat: add GlobeScratchMap component with clickable country meshes"
```

---

## Task 4: Add Toggle Button to ScratchMap

**Files:**
- Modify: `app/components/ScratchMap.vue`

- [ ] **Step 1: Add `toggleView` to emits**

In `ScratchMap.vue`, find the `defineEmits` (line 17-19):

```ts
const emit = defineEmits<{
  countryClick: [country: CountryInfo]
}>()
```

Change to:

```ts
const emit = defineEmits<{
  countryClick: [country: CountryInfo]
  toggleView: []
}>()
```

- [ ] **Step 2: Add globe toggle button to zoom controls**

Find the zoom controls `<div>` (line 463-486). Add a globe button at the end, before the closing `</div>`:

```vue
      <button
        class="map-btn flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        title="Switch to 3D globe"
        @click="emit('toggleView')"
      >
        <Icon name="lucide:globe" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
```

- [ ] **Step 3: Verify dev server starts**

```bash
bun run dev
```

Expected: Globe icon button visible in zoom controls on the explore page.

- [ ] **Step 4: Commit**

```bash
git add app/components/ScratchMap.vue
git commit -m "feat: add globe view toggle button to ScratchMap controls"
```

---

## Task 5: Integrate Toggle in explore.vue

**Files:**
- Modify: `app/pages/explore.vue`

- [ ] **Step 1: Add viewMode state**

In `<script setup>`, after the existing refs (around line 58), add:

```ts
const viewMode = ref<"2d" | "3d">(
  (typeof localStorage !== "undefined" && localStorage.getItem("explore-view-mode") as "2d" | "3d") || "2d",
)

function handleToggleView() {
  viewMode.value = viewMode.value === "2d" ? "3d" : "2d"
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("explore-view-mode", viewMode.value)
  }
}
```

- [ ] **Step 2: Update the template to conditionally render maps**

Find the map container (around line 116-132). Replace the `<ScratchMap>` with a conditional:

```vue
<!-- Map + Panel Container -->
<div class="relative mt-6">
  <ScratchMap
    v-if="viewMode === '2d'"
    :visit-map="visitMap"
    :visa-status-map="visaStatusMap ?? {}"
    @country-click="handleCountryClick"
    @toggle-view="handleToggleView"
  />
  <GlobeScratchMap
    v-else
    :visit-map="visitMap"
    :visa-status-map="visaStatusMap ?? {}"
    @country-click="handleCountryClick"
    @toggle-view="handleToggleView"
  />
  <CountryDetailPanel
    :country="selectedCountry"
    :visit-type="selectedCountry ? visitMap.get(selectedCountry.alpha2) : undefined"
    :visa-status="selectedCountry ? visaStatusMap?.[selectedCountry.alpha2] : undefined"
    :loading="panelLoading"
    @close="closePanel"
    @set-visit-type="setVisitType"
    @check-visa="handleCheckVisa"
  />
</div>
```

- [ ] **Step 3: Verify the full flow**

```bash
bun run dev
```

Navigate to /explore. Verify:
1. 2D map loads by default
2. Globe toggle button appears in zoom controls
3. Clicking it switches to 3D globe view
4. Globe shows countries colored by visit status
5. Clicking a country opens the same CountryDetailPanel
6. Map toggle button on globe switches back to 2D
7. View preference persists on page reload
8. Hover tooltips work on desktop

- [ ] **Step 4: Commit**

```bash
git add "app/pages/explore.vue"
git commit -m "feat: integrate 2D/3D map toggle on explore page"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Full flow test**

```bash
bun run dev
```

Test the complete flow:
1. Navigate to /explore, verify 2D map loads
2. Click globe toggle → 3D globe renders with correct country colors
3. Click a visited country → CountryDetailPanel opens with correct data
4. Change visit type in panel → globe updates color immediately
5. Hover countries on desktop → tooltip shows name, visit status, visa info
6. Click a country → globe auto-centers on it
7. Scroll to zoom in/out on globe
8. Drag to rotate globe
9. Toggle fullscreen on globe
10. Switch back to 2D → map renders correctly
11. Toggle dark/light mode → globe colors update
12. Refresh page → view mode preference persisted

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
