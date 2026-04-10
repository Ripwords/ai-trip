<script setup lang="ts">
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryByNumeric, type CountryInfo } from "../data/countries";

export type VisitType = "visited" | "layover" | "want_to_visit";

const props = defineProps<{
  /** Map of country alpha-2 code → visit type */
  visitMap: Map<string, VisitType>;
}>();

const emit = defineEmits<{
  countryClick: [country: CountryInfo];
}>();

// SVG projection
const projection = geoNaturalEarth1()
  .scale(160)
  .translate([480, 300]);

const pathGenerator = geoPath().projection(projection);

interface CountryPath {
  d: string;
  id: string;
  info: CountryInfo | undefined;
}

// Lazy-load the 10m TopoJSON (~3.6MB) so it doesn't block initial render
const mapLoaded = ref(false);
const staticPaths = ref<CountryPath[]>([]);

onMounted(async () => {
  const response = await fetch("/data/countries-10m.json");
  const worldData = (await response.json()) as Topology;
  const countriesGeo = feature(
    worldData,
    worldData.objects.countries as GeometryCollection
  );

  staticPaths.value = countriesGeo.features.map((f) => {
    const numericId = String(f.id);
    const info = countryByNumeric.get(numericId.padStart(3, "0"));
    return {
      d: pathGenerator(f) ?? "",
      id: numericId,
      info,
    };
  });
  mapLoaded.value = true;
});

// Reactive visit status
const countryPaths = computed(() =>
  staticPaths.value.map((p) => {
    const visitType = p.info ? props.visitMap.get(p.info.alpha2) : undefined;
    return { ...p, visitType };
  })
);

function handleClick(info: CountryInfo | undefined) {
  if (info) emit("countryClick", info);
}

// ── Hover & Tooltip ─────────────────────────────────────────────────
const hoveredId = ref<string | null>(null);
const hoveredInfo = ref<CountryInfo | null>(null);
const tooltipX = ref(0);
const tooltipY = ref(0);
const mapContainerRef = ref<HTMLElement | null>(null);

function handleMouseEnter(id: string, info: CountryInfo | undefined) {
  hoveredId.value = id;
  hoveredInfo.value = info ?? null;
}

function handleMouseLeave() {
  hoveredId.value = null;
  hoveredInfo.value = null;
}

function handleMouseMove(e: MouseEvent) {
  if (!mapContainerRef.value) return;
  const rect = mapContainerRef.value.getBoundingClientRect();
  tooltipX.value = e.clientX - rect.left;
  tooltipY.value = e.clientY - rect.top;
}

const tooltipLabel = computed(() => {
  if (!hoveredInfo.value) return null;
  const vt = props.visitMap.get(hoveredInfo.value.alpha2);
  if (vt === "visited") return "Visited";
  if (vt === "layover") return "Layover";
  if (vt === "want_to_visit") return "Want to visit";
  return null;
});

// Stats
const visitedCount = computed(() => [...props.visitMap.values()].filter((v) => v === "visited").length);
const layoverCount = computed(() => [...props.visitMap.values()].filter((v) => v === "layover").length);
const wantCount = computed(() => [...props.visitMap.values()].filter((v) => v === "want_to_visit").length);

// ── Zoom & Pan ──────────────────────────────────────────────────────
const svgRef = ref<SVGSVGElement | null>(null);
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });

const MIN_SCALE = 1;
const MAX_SCALE = 30;
const ZOOM_STEP = 0.2;

const transformStr = computed(
  () => `translate(${translateX.value},${translateY.value}) scale(${scale.value})`
);

function clampTranslation() {
  const minTx = 960 * (1 - scale.value);
  translateX.value = Math.max(minTx, Math.min(0, translateX.value));
  const minTy = 600 * (1 - scale.value);
  translateY.value = Math.max(minTy, Math.min(0, translateY.value));
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const svg = svgRef.value;
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  const mouseX = ((e.clientX - rect.left) / rect.width) * 960;
  const mouseY = ((e.clientY - rect.top) / rect.height) * 600;

  const oldScale = scale.value;
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + delta * oldScale));

  const ratio = newScale / oldScale;
  translateX.value = mouseX - ratio * (mouseX - translateX.value);
  translateY.value = mouseY - ratio * (mouseY - translateY.value);
  scale.value = newScale;

  if (newScale <= MIN_SCALE) {
    translateX.value = 0;
    translateY.value = 0;
  } else {
    clampTranslation();
  }
}

const didDrag = ref(false);
const pointerOrigin = ref({ x: 0, y: 0 });
const DRAG_THRESHOLD = 5; // px

function handlePointerDown(e: PointerEvent) {
  isPanning.value = true;
  didDrag.value = false;
  panStart.value = { x: e.clientX, y: e.clientY };
  pointerOrigin.value = { x: e.clientX, y: e.clientY };
}

function handlePointerMove(e: PointerEvent) {
  if (!isPanning.value || !svgRef.value) return;
  if (scale.value <= MIN_SCALE) return;

  const dx = Math.abs(e.clientX - pointerOrigin.value.x);
  const dy = Math.abs(e.clientY - pointerOrigin.value.y);
  if (!didDrag.value && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
  didDrag.value = true;

  const rect = svgRef.value.getBoundingClientRect();
  const movX = ((e.clientX - panStart.value.x) / rect.width) * 960;
  const movY = ((e.clientY - panStart.value.y) / rect.height) * 600;
  translateX.value += movX;
  translateY.value += movY;
  clampTranslation();
  panStart.value = { x: e.clientX, y: e.clientY };
}

function handlePointerUp(e: PointerEvent) {
  const wasDrag = didDrag.value;
  isPanning.value = false;
  didDrag.value = false;

  // If it wasn't a drag, treat as a click — find country under cursor
  if (!wasDrag) {
    // Use elementsFromPoint to find the path under the cursor
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els) {
      const cid = (el as HTMLElement).dataset?.cid;
      if (cid) {
        const country = countryPaths.value.find((c) => c.id === cid);
        if (country?.info) {
          handleClick(country.info);
          break;
        }
      }
    }
  }
}

function zoomIn() {
  const oldScale = scale.value;
  scale.value = Math.min(MAX_SCALE, oldScale + ZOOM_STEP * oldScale);
  const ratio = scale.value / oldScale;
  translateX.value = 480 - ratio * (480 - translateX.value);
  translateY.value = 300 - ratio * (300 - translateY.value);
  clampTranslation();
}

function zoomOut() {
  const oldScale = scale.value;
  scale.value = Math.max(MIN_SCALE, oldScale - ZOOM_STEP * oldScale);
  if (scale.value <= MIN_SCALE) {
    translateX.value = 0;
    translateY.value = 0;
  } else {
    const ratio = scale.value / oldScale;
    translateX.value = 480 - ratio * (480 - translateX.value);
    translateY.value = 300 - ratio * (300 - translateY.value);
    clampTranslation();
  }
}

function resetZoom() {
  scale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
}
</script>

<template>
  <!-- Outer wrapper: holds overlays, no overflow clipping -->
  <div
    ref="mapContainerRef"
    class="scratch-map relative rounded-2xl border border-sand-200"
    @mousemove="handleMouseMove"
  >
    <!-- Loading indicator -->
    <div v-if="!mapLoaded" class="flex items-center justify-center rounded-2xl" style="aspect-ratio: 960/600">
      <div class="map-overlay-text flex items-center gap-2 text-sm">
        <Icon name="lucide:loader" class="h-5 w-5 animate-spin" />
        Loading map...
      </div>
    </div>

    <!-- Inner SVG container: overflow-hidden for zoom/pan clipping -->
    <div v-else class="overflow-hidden rounded-2xl">
      <svg
        ref="svgRef"
        viewBox="0 0 960 600"
        class="block w-full select-none"
        :class="{ 'cursor-grab': scale > 1.05, 'cursor-grabbing': isPanning }"
        xmlns="http://www.w3.org/2000/svg"
        @wheel="handleWheel"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp($event)"
        @pointercancel="handlePointerUp($event)"
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
              hoveredId === country.id && country.visitType === 'visited' ? 'map-visited-hover' : '',
              hoveredId === country.id && country.visitType === 'layover' ? 'map-layover-hover' : '',
              hoveredId === country.id && country.visitType === 'want_to_visit' ? 'map-want-hover' : '',
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

    <!-- Floating tooltip -->
    <div
      v-if="hoveredInfo"
      class="map-tooltip pointer-events-none absolute z-20 rounded-lg px-3 py-1.5 text-sm font-medium shadow-lg"
      :style="{ left: `${tooltipX + 14}px`, top: `${tooltipY - 10}px` }"
    >
      {{ hoveredInfo.name }}
      <span v-if="tooltipLabel" class="map-tooltip-badge ml-1.5 rounded px-1.5 py-0.5 text-xs">
        {{ tooltipLabel }}
      </span>
    </div>

    <!-- Zoom controls -->
    <div class="absolute right-3 top-3 flex flex-col gap-1">
      <button
        class="map-btn flex h-8 w-8 items-center justify-center rounded-lg shadow transition"
        title="Zoom in"
        @click="zoomIn"
      >
        <Icon name="lucide:plus" class="h-4 w-4" />
      </button>
      <button
        class="map-btn flex h-8 w-8 items-center justify-center rounded-lg shadow transition"
        title="Zoom out"
        @click="zoomOut"
      >
        <Icon name="lucide:minus" class="h-4 w-4" />
      </button>
      <button
        v-if="scale > 1"
        class="map-btn flex h-8 w-8 items-center justify-center rounded-lg shadow transition"
        title="Reset zoom"
        @click="resetZoom"
      >
        <Icon name="lucide:maximize-2" class="h-4 w-4" />
      </button>
    </div>

    <!-- Stats overlay -->
    <div class="map-overlay map-overlay-border absolute bottom-3 left-3 rounded-xl px-3 py-1.5 backdrop-blur-sm">
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
    <div v-if="scale > 1" class="map-overlay map-overlay-border map-overlay-text absolute bottom-3 right-3 rounded-lg px-2.5 py-1 text-xs font-medium backdrop-blur-sm">
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
.map-ocean { fill: var(--map-ocean); }
.map-country { fill: var(--map-country); }
.map-country-hover { fill: var(--map-country-hover); }
.map-visited { fill: var(--map-visited); }
.map-visited-hover { fill: var(--map-visited-hover); }
.map-layover { fill: var(--map-layover); }
.map-layover-hover { fill: var(--map-layover-hover); }
.map-want { fill: var(--map-want); }
.map-want-hover { fill: var(--map-want-hover); }
.map-border { stroke: var(--map-border); }

/* ── Tooltip ─────────────────────────────────────────── */
.map-tooltip {
  background: var(--map-tooltip-bg);
  color: var(--map-tooltip-text);
}
.map-tooltip-badge {
  background: var(--map-tooltip-badge-bg);
}

/* ── Overlay elements ──────────────────────────────────── */
.map-overlay { background: var(--map-overlay-bg); }
.map-overlay-border { border: 1px solid var(--map-overlay-border); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.map-overlay-text { color: var(--map-overlay-text); }
.map-overlay-accent { color: var(--map-overlay-accent); }
.map-layover-accent { color: var(--map-layover-accent-color); }
.map-want-accent { color: var(--map-want-accent-color); }
.map-btn {
  background: var(--map-btn-bg);
  color: var(--map-btn-text);
  backdrop-filter: blur(8px);
}
.map-btn:hover { background: var(--map-btn-hover); }
</style>
