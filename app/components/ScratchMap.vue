<script setup lang="ts">
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryByNumeric, type CountryInfo } from "../data/countries";
import worldTopoJson from "../data/countries-110m.json";

const props = defineProps<{
  visitedCodes: Set<string>; // Set of ISO alpha-2 codes
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

// SVG projection — Natural Earth is great for world maps
const projection = geoNaturalEarth1()
  .scale(160)
  .translate([480, 300]);

const pathGenerator = geoPath().projection(projection);

// Precompute paths and metadata for each country
const countryPaths = computed(() =>
  countriesGeo.features.map((f) => {
    const numericId = String(f.id);
    const info = countryByNumeric.get(numericId.padStart(3, "0"));
    const isVisited = info ? props.visitedCodes.has(info.alpha2) : false;

    return {
      d: pathGenerator(f) ?? "",
      id: numericId,
      info,
      isVisited,
    };
  })
);

function handleClick(info: CountryInfo | undefined) {
  if (info) emit("countryClick", info);
}

// Hover state
const hoveredId = ref<string | null>(null);
</script>

<template>
  <div class="relative overflow-hidden rounded-2xl border border-sand-200 bg-sand-100 dark:border-sand-700 dark:bg-sand-800">
    <svg
      viewBox="0 0 960 600"
      class="w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- Ocean background -->
      <rect width="960" height="600" class="fill-blue-50 dark:fill-blue-950/30" />

      <!-- Country paths -->
      <path
        v-for="country in countryPaths"
        :key="country.id"
        :d="country.d"
        class="cursor-pointer stroke-sand-300 transition-colors duration-150 dark:stroke-sand-700"
        :class="[
          country.isVisited
            ? 'fill-terra-400 dark:fill-terra-500'
            : 'fill-sand-200 hover:fill-sand-300 dark:fill-sand-700 dark:hover:fill-sand-600',
          hoveredId === country.id && !country.isVisited ? 'fill-sand-300 dark:fill-sand-600' : '',
          hoveredId === country.id && country.isVisited ? 'fill-terra-500 dark:fill-terra-400' : '',
        ]"
        stroke-width="0.5"
        @click="handleClick(country.info)"
        @mouseenter="hoveredId = country.id"
        @mouseleave="hoveredId = null"
      >
        <title v-if="country.info">
          {{ country.info.name }}{{ country.isVisited ? ' (visited)' : '' }}
        </title>
      </path>
    </svg>

    <!-- Stats overlay -->
    <div class="absolute bottom-4 left-4 rounded-xl bg-white/80 px-4 py-2 backdrop-blur-sm dark:bg-sand-900/80">
      <p class="text-sm font-medium text-sand-900 dark:text-sand-100">
        <span class="text-lg font-bold text-terra-600">{{ visitedCodes.size }}</span>
        / {{ countryPaths.filter(c => c.info).length }} countries visited
      </p>
    </div>
  </div>
</template>
