<script setup lang="ts">
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryByNumeric, type CountryInfo } from "../data/countries";
import worldTopoJson from "../data/countries-110m.json";

const props = defineProps<{
  visitedCodes: Set<string>;
}>();

const emit = defineEmits<{
  countryClick: [country: CountryInfo];
}>();

// Convert TopoJSON to GeoJSON features
const worldData = worldTopoJson as unknown as Topology;
const countriesGeo = feature(
  worldData,
  worldData.objects.countries as GeometryCollection
);

// SVG projection
const projection = geoNaturalEarth1()
  .scale(160)
  .translate([480, 300]);

const pathGenerator = geoPath().projection(projection);

// Pre-compute static paths (only depends on GeoJSON, never changes)
const staticPaths = countriesGeo.features.map((f) => {
  const numericId = String(f.id);
  const info = countryByNumeric.get(numericId.padStart(3, "0"));
  return {
    d: pathGenerator(f) ?? "",
    id: numericId,
    info,
  };
});

// Reactive visited status
const countryPaths = computed(() =>
  staticPaths.map((p) => ({
    ...p,
    isVisited: p.info ? props.visitedCodes.has(p.info.alpha2) : false,
  }))
);

function handleClick(info: CountryInfo | undefined) {
  if (info) emit("countryClick", info);
}

const hoveredId = ref<string | null>(null);

// ── Zoom & Pan ──────────────────────────────────────────────────────
const svgRef = ref<SVGSVGElement | null>(null);
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.2;

const transformStr = computed(
  () => `translate(${translateX.value},${translateY.value}) scale(${scale.value})`
);

function clampTranslation() {
  // At scale S, content spans [0, 960*S] in viewBox coords after translate.
  // To keep content covering the 960x600 viewBox:
  //   tx must be in [960*(1-S), 0]
  //   ty must be in [600*(1-S), 0]
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

function handlePointerDown(e: PointerEvent) {
  if (scale.value <= MIN_SCALE) return;
  isPanning.value = true;
  panStart.value = { x: e.clientX, y: e.clientY };
  (e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
  if (!isPanning.value || !svgRef.value) return;
  const rect = svgRef.value.getBoundingClientRect();
  const dx = ((e.clientX - panStart.value.x) / rect.width) * 960;
  const dy = ((e.clientY - panStart.value.y) / rect.height) * 600;
  translateX.value += dx;
  translateY.value += dy;
  clampTranslation();
  panStart.value = { x: e.clientX, y: e.clientY };
}

function handlePointerUp() {
  isPanning.value = false;
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
  <div class="scratch-map relative overflow-hidden rounded-2xl border border-sand-200">
    <svg
      ref="svgRef"
      viewBox="0 0 960 600"
      class="w-full select-none"
      :class="{ 'cursor-grab': scale > 1, 'cursor-grabbing': isPanning }"
      xmlns="http://www.w3.org/2000/svg"
      @wheel="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
    >
      <!-- Ocean background -->
      <rect width="960" height="600" class="map-ocean" />

      <!-- Transformable group for zoom/pan -->
      <g :transform="transformStr">
        <path
          v-for="country in countryPaths"
          :key="country.id"
          :d="country.d"
          class="map-border transition-colors duration-150"
          :class="[
            country.info ? 'cursor-pointer' : 'cursor-default',
            country.isVisited
              ? 'map-visited'
              : 'map-country',
            hoveredId === country.id && !country.isVisited ? 'map-country-hover' : '',
            hoveredId === country.id && country.isVisited ? 'map-visited-hover' : '',
          ]"
          :stroke-width="0.5 / scale"
          @click="handleClick(country.info)"
          @mouseenter="hoveredId = country.id"
          @mouseleave="hoveredId = null"
        >
          <title v-if="country.info">
            {{ country.info.name }}{{ country.isVisited ? ' (visited)' : '' }}
          </title>
        </path>
      </g>
    </svg>

    <!-- Zoom controls -->
    <div class="absolute right-4 top-4 flex flex-col gap-1">
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
    <div class="map-overlay absolute bottom-4 left-4 rounded-xl px-4 py-2 backdrop-blur-sm">
      <p class="map-overlay-text text-sm font-medium">
        <span class="map-overlay-accent text-lg font-bold">{{ visitedCodes.size }}</span>
        / {{ countryPaths.filter(c => c.info).length }} countries visited
      </p>
    </div>

    <!-- Zoom level indicator -->
    <div v-if="scale > 1" class="map-overlay absolute bottom-4 right-4 rounded-lg px-2.5 py-1 text-xs backdrop-blur-sm">
      {{ Math.round(scale * 100) }}%
    </div>
  </div>
</template>

<style scoped>
/*
 * Map-specific color palette — independent from the theme auto-swap system.
 * The global .dark class swaps sand/terra/ocean CSS vars which doesn't work
 * well for data visualizations. These hardcoded values ensure the map looks
 * intentional in both modes.
 */

/* ── Light Mode ────────────────────────────────────────── */
.scratch-map {
  --map-ocean: #dceef5;
  --map-country: #e6ddd0;
  --map-country-hover: #d6cab9;
  --map-visited: #f07b5a;
  --map-visited-hover: #e85d3a;
  --map-border: #cfc2b2;
  --map-overlay-bg: rgba(255, 255, 255, 0.82);
  --map-overlay-text: #3d3328;
  --map-overlay-accent: #d44425;
  --map-btn-bg: rgba(255, 255, 255, 0.82);
  --map-btn-text: #5a4b3a;
  --map-btn-hover: rgba(255, 255, 255, 1);
  background: var(--map-ocean);
}

/* ── Dark Mode — rich atlas aesthetic ──────────────────── */
:global(.dark) .scratch-map {
  --map-ocean: #0c1524;
  --map-country: #1e3044;
  --map-country-hover: #2a4460;
  --map-visited: #f07b5a;
  --map-visited-hover: #f7a48a;
  --map-border: #152336;
  --map-overlay-bg: rgba(12, 21, 36, 0.85);
  --map-overlay-text: #c8d6e5;
  --map-overlay-accent: #f07b5a;
  --map-btn-bg: rgba(30, 48, 68, 0.85);
  --map-btn-text: #c8d6e5;
  --map-btn-hover: rgba(42, 68, 96, 0.95);
  border-color: #1e3044;
  background: var(--map-ocean);
}

/* ── SVG fills ─────────────────────────────────────────── */
.map-ocean { fill: var(--map-ocean); }
.map-country { fill: var(--map-country); }
.map-country-hover { fill: var(--map-country-hover); }
.map-visited { fill: var(--map-visited); }
.map-visited-hover { fill: var(--map-visited-hover); }
.map-border { stroke: var(--map-border); }

/* ── Overlay elements ──────────────────────────────────── */
.map-overlay {
  background: var(--map-overlay-bg);
}
.map-overlay-text {
  color: var(--map-overlay-text);
}
.map-overlay-accent {
  color: var(--map-overlay-accent);
}
.map-btn {
  background: var(--map-btn-bg);
  color: var(--map-btn-text);
  backdrop-filter: blur(8px);
}
.map-btn:hover {
  background: var(--map-btn-hover);
}
</style>
