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

// Reactive visited status (recomputes only when visitedCodes changes)
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
  // Allow panning within reasonable bounds based on current scale
  const maxPan = 480 * (scale.value - 1);
  translateX.value = Math.max(-maxPan, Math.min(maxPan, translateX.value));
  const maxPanY = 300 * (scale.value - 1);
  translateY.value = Math.max(-maxPanY, Math.min(maxPanY, translateY.value));
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const svg = svgRef.value;
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  // Mouse position in SVG coordinates
  const mouseX = ((e.clientX - rect.left) / rect.width) * 960;
  const mouseY = ((e.clientY - rect.top) / rect.height) * 600;

  const oldScale = scale.value;
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + delta * oldScale));

  // Zoom toward mouse position
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
  // Zoom toward center
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
  <div class="relative overflow-hidden rounded-2xl border border-sand-200 bg-ocean-100">
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
      <rect width="960" height="600" class="fill-ocean-100" />

      <!-- Transformable group for zoom/pan -->
      <g :transform="transformStr">
        <path
          v-for="country in countryPaths"
          :key="country.id"
          :d="country.d"
          class="stroke-sand-300 transition-colors duration-150"
          :class="[
            country.info ? 'cursor-pointer' : 'cursor-default',
            country.isVisited
              ? 'fill-terra-400'
              : 'fill-sand-200',
            hoveredId === country.id && !country.isVisited ? 'fill-sand-300' : '',
            hoveredId === country.id && country.isVisited ? 'fill-terra-500' : '',
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
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-sand-700 shadow backdrop-blur-sm transition hover:bg-white"
        title="Zoom in"
        @click="zoomIn"
      >
        <Icon name="lucide:plus" class="h-4 w-4" />
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-sand-700 shadow backdrop-blur-sm transition hover:bg-white"
        title="Zoom out"
        @click="zoomOut"
      >
        <Icon name="lucide:minus" class="h-4 w-4" />
      </button>
      <button
        v-if="scale > 1"
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-sand-700 shadow backdrop-blur-sm transition hover:bg-white"
        title="Reset zoom"
        @click="resetZoom"
      >
        <Icon name="lucide:maximize-2" class="h-4 w-4" />
      </button>
    </div>

    <!-- Stats overlay -->
    <div class="absolute bottom-4 left-4 rounded-xl bg-white/80 px-4 py-2 backdrop-blur-sm">
      <p class="text-sm font-medium text-sand-900">
        <span class="text-lg font-bold text-terra-600">{{ visitedCodes.size }}</span>
        / {{ countryPaths.filter(c => c.info).length }} countries visited
      </p>
    </div>

    <!-- Zoom level indicator -->
    <div v-if="scale > 1" class="absolute bottom-4 right-4 rounded-lg bg-white/80 px-2.5 py-1 text-xs text-sand-500 backdrop-blur-sm">
      {{ Math.round(scale * 100) }}%
    </div>
  </div>
</template>
