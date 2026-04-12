<script setup lang="ts">
import { geoNaturalEarth1, geoPath } from "d3-geo"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import { countryByNumeric, type CountryInfo } from "../data/countries"
import worldTopoJson from "../data/countries-50m.json"

export type VisitType = "visited" | "layover" | "want_to_visit"

const props = defineProps<{
  /** Map of country alpha-2 code → visit type */
  visitMap: Map<string, VisitType>
  /** Map of country alpha-2 code → visa status from bulk lookup */
  visaStatusMap: Record<string, { visaStatus: string; maxStayDays: number | null }>
}>()

const emit = defineEmits<{
  countryClick: [country: CountryInfo]
}>()

// Convert TopoJSON to GeoJSON features
const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)

// SVG projection
const projection = geoNaturalEarth1().scale(160).translate([480, 300])

const pathGenerator = geoPath().projection(projection)

// Pre-compute static paths (only depends on GeoJSON, never changes)
const staticPaths = countriesGeo.features.map((f) => {
  const numericId = String(f.id)
  const info = countryByNumeric.get(numericId.padStart(3, "0"))
  return {
    d: pathGenerator(f) ?? "",
    id: numericId,
    info,
  }
})

// Reactive visit status
const countryPaths = computed(() =>
  staticPaths.map((p) => {
    const visitType = p.info ? props.visitMap.get(p.info.alpha2) : undefined
    return Object.assign({}, p, { visitType })
  }),
)

function handleClick(info: CountryInfo | undefined) {
  if (info) emit("countryClick", info)
}

// ── Hover & Tooltip ─────────────────────────────────────────────────
const hoveredId = ref<string | null>(null)
const hoveredInfo = ref<CountryInfo | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)
const mapContainerRef = ref<HTMLElement | null>(null)

function handleMouseEnter(id: string, info: CountryInfo | undefined) {
  hoveredId.value = id
  hoveredInfo.value = info ?? null
}

function handleMouseLeave() {
  hoveredId.value = null
  hoveredInfo.value = null
}

function handleMouseMove(e: MouseEvent) {
  if (!mapContainerRef.value) return
  const rect = mapContainerRef.value.getBoundingClientRect()
  tooltipX.value = e.clientX - rect.left
  tooltipY.value = e.clientY - rect.top
}

const tooltipLabel = computed(() => {
  if (!hoveredInfo.value) return null
  const vt = props.visitMap.get(hoveredInfo.value.alpha2)
  if (vt === "visited") return "Visited"
  if (vt === "layover") return "Layover"
  if (vt === "want_to_visit") return "Want to visit"
  return null
})

const VISA_LABEL: Record<string, string> = {
  "visa-free": "Visa Free",
  "visa-on-arrival": "Visa on Arrival",
  evisa: "e-Visa",
  "visa-required": "Visa Required",
}

const VISA_COLOR: Record<string, string> = {
  "visa-free": "map-tooltip-visa-free",
  "visa-on-arrival": "map-tooltip-visa-arrival",
  evisa: "map-tooltip-visa-evisa",
  "visa-required": "map-tooltip-visa-required",
}

const tooltipVisa = computed(() => {
  if (!hoveredInfo.value) return null
  const entry = props.visaStatusMap[hoveredInfo.value.alpha2]
  if (!entry) return null
  return {
    label: VISA_LABEL[entry.visaStatus] ?? entry.visaStatus,
    colorClass: VISA_COLOR[entry.visaStatus] ?? "",
    maxStayDays: entry.maxStayDays,
  }
})

// Stats
const visitedCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "visited").length,
)
const layoverCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "layover").length,
)
const wantCount = computed(
  () => [...props.visitMap.values()].filter((v) => v === "want_to_visit").length,
)

// ── Zoom & Pan ──────────────────────────────────────────────────────
const svgRef = ref<SVGSVGElement | null>(null)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0 })

const MIN_SCALE = 1
const MAX_SCALE = 100
const ZOOM_STEP = 0.2

const transformStr = computed(
  () => `translate(${translateX.value},${translateY.value}) scale(${scale.value})`,
)

function clampTranslation() {
  const minTx = 960 * (1 - scale.value)
  translateX.value = Math.max(minTx, Math.min(0, translateX.value))
  const minTy = 600 * (1 - scale.value)
  translateY.value = Math.max(minTy, Math.min(0, translateY.value))
}

/** Apply zoom centered on a point in SVG-space (0..960, 0..600) */
function zoomAtPoint(focalX: number, focalY: number, newScale: number) {
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale))
  const ratio = clamped / scale.value
  translateX.value = focalX - ratio * (focalX - translateX.value)
  translateY.value = focalY - ratio * (focalY - translateY.value)
  scale.value = clamped

  if (clamped <= MIN_SCALE) {
    translateX.value = 0
    translateY.value = 0
  } else {
    clampTranslation()
  }
}

/** Convert a client pixel position to SVG-space coordinates */
function clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
  const svg = svgRef.value
  if (!svg) return { x: 480, y: 300 }
  const rect = svg.getBoundingClientRect()
  return {
    x: ((clientX - rect.left) / rect.width) * 960,
    y: ((clientY - rect.top) / rect.height) * 600,
  }
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const focal = clientToSvg(e.clientX, e.clientY)
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
  zoomAtPoint(focal.x, focal.y, scale.value + delta * scale.value)
}

const didDrag = ref(false)
const pointerOrigin = ref({ x: 0, y: 0 })
const DRAG_THRESHOLD = 5 // px

function handlePointerDown(e: PointerEvent) {
  // Skip if a pinch gesture is active (handled by touch events)
  if (isPinching.value) return
  isPanning.value = true
  didDrag.value = false
  panStart.value = { x: e.clientX, y: e.clientY }
  pointerOrigin.value = { x: e.clientX, y: e.clientY }
}

function handlePointerMove(e: PointerEvent) {
  if (isPinching.value) return
  if (!isPanning.value || !svgRef.value) return
  if (scale.value <= MIN_SCALE) return

  const dx = Math.abs(e.clientX - pointerOrigin.value.x)
  const dy = Math.abs(e.clientY - pointerOrigin.value.y)
  if (!didDrag.value && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
  didDrag.value = true

  const rect = svgRef.value.getBoundingClientRect()
  const movX = ((e.clientX - panStart.value.x) / rect.width) * 960
  const movY = ((e.clientY - panStart.value.y) / rect.height) * 600
  translateX.value += movX
  translateY.value += movY
  clampTranslation()
  panStart.value = { x: e.clientX, y: e.clientY }
}

function handlePointerUp(e: PointerEvent) {
  if (isPinching.value) return
  const wasDrag = didDrag.value
  isPanning.value = false
  didDrag.value = false

  // If it wasn't a drag, treat as a click — find country under cursor
  if (!wasDrag) {
    // Use elementsFromPoint to find the path under the cursor
    const els = document.elementsFromPoint(e.clientX, e.clientY)
    for (const el of els) {
      const cid = (el as HTMLElement).dataset?.cid
      if (cid) {
        const country = countryPaths.value.find((c) => c.id === cid)
        if (country?.info) {
          handleClick(country.info)
          break
        }
      }
    }
  }
}

// ── Touch: Pinch-to-Zoom ───────────────────────────────────────────
const isPinching = ref(false)
const lastPinchDist = ref(0)
const lastPinchCenter = ref({ x: 0, y: 0 })

function getTouchDistance(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function getTouchCenter(t1: Touch, t2: Touch): { x: number; y: number } {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  }
}

const touchStartPos = ref({ x: 0, y: 0 })
const TAP_THRESHOLD = 10 // px — max movement to count as a tap

function handleTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault()
    isPinching.value = true
    isPanning.value = false
    didDrag.value = true // prevent click on release
    lastPinchDist.value = getTouchDistance(e.touches[0]!, e.touches[1]!)
    const center = getTouchCenter(e.touches[0]!, e.touches[1]!)
    lastPinchCenter.value = center
  } else if (e.touches.length === 1) {
    touchStartPos.value = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
  }
}

function handleTouchMove(e: TouchEvent) {
  if (!isPinching.value || e.touches.length < 2) return
  e.preventDefault()

  const dist = getTouchDistance(e.touches[0]!, e.touches[1]!)
  const center = getTouchCenter(e.touches[0]!, e.touches[1]!)
  const focal = clientToSvg(center.x, center.y)

  // Scale change based on pinch distance ratio
  const ratio = dist / lastPinchDist.value
  const newScale = scale.value * ratio

  zoomAtPoint(focal.x, focal.y, newScale)

  // Pan for center movement while pinching
  if (scale.value > MIN_SCALE && svgRef.value) {
    const rect = svgRef.value.getBoundingClientRect()
    const panDx = ((center.x - lastPinchCenter.value.x) / rect.width) * 960
    const panDy = ((center.y - lastPinchCenter.value.y) / rect.height) * 600
    translateX.value += panDx
    translateY.value += panDy
    clampTranslation()
  }

  lastPinchDist.value = dist
  lastPinchCenter.value = center
}

function handleTouchEnd(e: TouchEvent) {
  const wasPinching = isPinching.value
  if (e.touches.length < 2) {
    isPinching.value = false
  }

  // Single-finger tap detection: touch-action:none suppresses click events,
  // so we detect taps here and trigger the country click manually.
  if (e.touches.length === 0 && !wasPinching && e.changedTouches.length === 1) {
    const touch = e.changedTouches[0]!
    const dx = Math.abs(touch.clientX - touchStartPos.value.x)
    const dy = Math.abs(touch.clientY - touchStartPos.value.y)
    if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
      const els = document.elementsFromPoint(touch.clientX, touch.clientY)
      for (const el of els) {
        const cid = (el as HTMLElement).dataset?.cid
        if (cid) {
          const country = countryPaths.value.find((c) => c.id === cid)
          if (country?.info) {
            handleClick(country.info)
            break
          }
        }
      }
    }
  }
}

// ── Fullscreen (mobile) ────────────────────────────────────────────
const isFullscreen = ref(false)

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  if (isFullscreen.value) {
    document.body.style.overflow = "hidden"
  } else {
    document.body.style.overflow = ""
  }
}

onMounted(() => {
  // Default zoom in slightly on mobile so the map isn't so zoomed out
  if (window.innerWidth < 640) {
    scale.value = 1.8
    // Center the zoom on the map center (480, 300 in SVG-space)
    translateX.value = 480 * (1 - 1.8)
    translateY.value = 300 * (1 - 1.8)
    clampTranslation()
  }
})

onUnmounted(() => {
  document.body.style.overflow = ""
})

function zoomIn() {
  zoomAtPoint(480, 300, scale.value + ZOOM_STEP * scale.value)
}

function zoomOut() {
  zoomAtPoint(480, 300, scale.value - ZOOM_STEP * scale.value)
}

function resetZoom() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}
</script>

<template>
  <!-- Outer wrapper: holds overlays, no overflow clipping -->
  <div
    ref="mapContainerRef"
    class="scratch-map relative rounded-2xl border border-sand-200"
    :class="{
      'scratch-map--fullscreen fixed inset-0 z-[100] rounded-none border-none': isFullscreen,
    }"
    @mousemove="handleMouseMove"
  >
    <!-- Inner SVG container: overflow-hidden for zoom/pan clipping -->
    <div class="overflow-hidden" :class="isFullscreen ? 'h-full' : 'rounded-2xl'">
      <svg
        ref="svgRef"
        viewBox="0 0 960 600"
        class="block w-full select-none"
        :class="[
          isFullscreen ? 'h-full' : '',
          { 'cursor-grab': scale > 1.05, 'cursor-grabbing': isPanning },
        ]"
        style="touch-action: none"
        xmlns="http://www.w3.org/2000/svg"
        @wheel="handleWheel"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp($event)"
        @pointercancel="handlePointerUp($event)"
        @touchstart.passive="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend.passive="handleTouchEnd"
        @touchcancel.passive="handleTouchEnd"
      >
        <!-- Ocean background -->
        <rect width="960" height="600" class="map-ocean" />

        <!-- Transformable group for zoom/pan -->
        <g :transform="transformStr">
          <path
            v-for="country in countryPaths"
            :key="country.id"
            :d="country.d"
            :data-cid="country.id"
            class="map-border transition-colors duration-150"
            :class="[
              country.info ? 'cursor-pointer' : 'cursor-default',
              country.visitType === 'visited' ? 'map-visited' : '',
              country.visitType === 'layover' ? 'map-layover' : '',
              country.visitType === 'want_to_visit' ? 'map-want' : '',
              !country.visitType ? 'map-country' : '',
              hoveredId === country.id && !country.visitType ? 'map-country-hover' : '',
              hoveredId === country.id && country.visitType === 'visited'
                ? 'map-visited-hover'
                : '',
              hoveredId === country.id && country.visitType === 'layover'
                ? 'map-layover-hover'
                : '',
              hoveredId === country.id && country.visitType === 'want_to_visit'
                ? 'map-want-hover'
                : '',
            ]"
            :stroke-width="0.5 / scale"
            @click="handleClick(country.info)"
            @mouseenter="handleMouseEnter(country.id, country.info)"
            @mouseleave="handleMouseLeave"
          />
        </g>
      </svg>
    </div>

    <!-- Everything below is outside overflow-hidden, so never clipped -->

    <!-- Floating tooltip (desktop only — hidden on touch) -->
    <div
      v-if="hoveredInfo"
      class="map-tooltip pointer-events-none absolute z-20 hidden rounded-lg px-3 py-1.5 shadow-lg sm:block"
      :style="{ left: `${tooltipX + 14}px`, top: `${tooltipY - 10}px` }"
    >
      <div class="flex items-center text-sm font-medium">
        <span>{{ hoveredInfo.name }}</span>
        <span v-if="tooltipLabel" class="map-tooltip-badge ml-1.5 rounded px-1.5 py-0.5 text-xs">
          {{ tooltipLabel }}
        </span>
      </div>
      <div
        v-if="tooltipVisa"
        class="mt-0.5 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs"
        :class="tooltipVisa.colorClass"
      >
        {{ tooltipVisa.label }}
        <span v-if="tooltipVisa.maxStayDays" class="opacity-75">
          {{ tooltipVisa.maxStayDays }}d
        </span>
      </div>
    </div>

    <!-- Zoom controls — larger on mobile (44px touch targets) -->
    <div class="absolute right-3 top-3 flex flex-col gap-1.5">
      <button
        class="map-btn flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        title="Zoom in"
        @click="zoomIn"
      >
        <Icon name="lucide:plus" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
      <button
        class="map-btn flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        title="Zoom out"
        @click="zoomOut"
      >
        <Icon name="lucide:minus" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
      <button
        v-if="scale > 1"
        class="map-btn flex h-11 w-11 items-center justify-center rounded-xl shadow-md transition sm:h-8 sm:w-8 sm:rounded-lg sm:shadow"
        title="Reset zoom"
        @click="resetZoom"
      >
        <Icon name="lucide:maximize-2" class="h-5 w-5 sm:h-4 sm:w-4" />
      </button>
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

    <!-- Zoom level indicator -->
    <div
      v-if="scale > 1"
      class="map-overlay map-overlay-border map-overlay-text absolute bottom-3 right-3 rounded-lg px-2.5 py-1 text-xs font-medium backdrop-blur-sm"
    >
      {{ Math.round(scale * 100) }}%
    </div>
  </div>
</template>

<style scoped>
/* ── Light Mode ────────────────────────────────────────── */
.scratch-map {
  --map-ocean: #dceef5;
  --map-country: #e6ddd0;
  --map-country-hover: #d6cab9;
  --map-visited: #f07b5a;
  --map-visited-hover: #e85d3a;
  --map-layover: #7dc3d4;
  --map-layover-hover: #4aa5b9;
  --map-want: #a78bfa;
  --map-want-hover: #8b5cf6;
  --map-border: #cfc2b2;
  --map-overlay-bg: rgba(255, 255, 255, 0.92);
  --map-overlay-border: rgba(0, 0, 0, 0.08);
  --map-overlay-text: #3d3328;
  --map-overlay-accent: #d44425;
  --map-layover-accent-color: #2e8a9e;
  --map-want-accent-color: #7c3aed;
  --map-btn-bg: rgba(255, 255, 255, 0.82);
  --map-btn-text: #5a4b3a;
  --map-btn-hover: rgba(255, 255, 255, 1);
  --map-tooltip-bg: #3d3328;
  --map-tooltip-text: #faf8f5;
  --map-tooltip-badge-bg: rgba(255, 255, 255, 0.18);
  background: var(--map-ocean);
}

/* ── Dark Mode ─────────────────────────────────────────── */
:global(.dark) .scratch-map {
  --map-ocean: #0c1524;
  --map-country: #1e3044;
  --map-country-hover: #2a4460;
  --map-visited: #f07b5a;
  --map-visited-hover: #f7a48a;
  --map-layover: #4aa5b9;
  --map-layover-hover: #7dc3d4;
  --map-want: #8b5cf6;
  --map-want-hover: #a78bfa;
  --map-border: #152336;
  --map-overlay-bg: rgba(12, 21, 36, 0.92);
  --map-overlay-border: rgba(255, 255, 255, 0.1);
  --map-overlay-text: #c8d6e5;
  --map-overlay-accent: #f07b5a;
  --map-layover-accent-color: #7dc3d4;
  --map-want-accent-color: #a78bfa;
  --map-btn-bg: rgba(30, 48, 68, 0.85);
  --map-btn-text: #c8d6e5;
  --map-btn-hover: rgba(42, 68, 96, 0.95);
  --map-tooltip-bg: #1e3044;
  --map-tooltip-text: #e2e8f0;
  --map-tooltip-badge-bg: rgba(255, 255, 255, 0.12);
  border-color: #1e3044;
  background: var(--map-ocean);
}

/* ── SVG fills ─────────────────────────────────────────── */
.map-ocean {
  fill: var(--map-ocean);
}
.map-country {
  fill: var(--map-country);
}
.map-country-hover {
  fill: var(--map-country-hover);
}
.map-visited {
  fill: var(--map-visited);
}
.map-visited-hover {
  fill: var(--map-visited-hover);
}
.map-layover {
  fill: var(--map-layover);
}
.map-layover-hover {
  fill: var(--map-layover-hover);
}
.map-want {
  fill: var(--map-want);
}
.map-want-hover {
  fill: var(--map-want-hover);
}
.map-border {
  stroke: var(--map-border);
}

/* ── Tooltip ─────────────────────────────────────────── */
.map-tooltip {
  background: var(--map-tooltip-bg);
  color: var(--map-tooltip-text);
}
.map-tooltip-badge {
  background: var(--map-tooltip-badge-bg);
}
.map-tooltip-visa-free {
  background: rgba(74, 222, 128, 0.2);
  color: #86efac;
}
.map-tooltip-visa-arrival {
  background: rgba(96, 165, 250, 0.2);
  color: #93c5fd;
}
.map-tooltip-visa-evisa {
  background: rgba(251, 191, 36, 0.2);
  color: #fcd34d;
}
.map-tooltip-visa-required {
  background: rgba(248, 113, 113, 0.2);
  color: #fca5a5;
}

/* ── Overlay elements ──────────────────────────────────── */
.map-overlay {
  background: var(--map-overlay-bg);
}
.map-overlay-border {
  border: 1px solid var(--map-overlay-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.map-overlay-text {
  color: var(--map-overlay-text);
}
.map-overlay-accent {
  color: var(--map-overlay-accent);
}
.map-layover-accent {
  color: var(--map-layover-accent-color);
}
.map-want-accent {
  color: var(--map-want-accent-color);
}
.map-btn {
  background: var(--map-btn-bg);
  color: var(--map-btn-text);
  backdrop-filter: blur(8px);
}
.map-btn:hover {
  background: var(--map-btn-hover);
}

/* ── Fullscreen ───────────────────────────────────────── */
.scratch-map--fullscreen {
  background: var(--map-ocean);
}
.scratch-map--fullscreen svg {
  /* Center the map vertically in fullscreen on mobile */
  object-fit: contain;
}

/* On mobile portrait, give the map more height by default */
@media (max-width: 639px) {
  .scratch-map:not(.scratch-map--fullscreen) {
    /* ~60vh instead of the natural ~200px from 960:600 aspect ratio */
    min-height: 50vh;
  }
  .scratch-map:not(.scratch-map--fullscreen) svg {
    min-height: 50vh;
  }
}
</style>
