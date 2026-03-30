<script setup lang="ts">
/// <reference types="google.maps" />

interface Activity {
  id: string;
  name: string;
  type: string;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
}

interface DayWithActivities {
  id: string;
  dayNumber: number;
  activities: Activity[];
}

const props = defineProps<{
  days: DayWithActivities[];
}>();

const DAY_COLORS = [
  "#E85D3A", "#3B82F6", "#22C55E", "#F59E0B", "#A855F7",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
];

function getDayColor(dayIndex: number): string {
  return DAY_COLORS[dayIndex % DAY_COLORS.length]!;
}

const mapContainer = ref<HTMLElement | null>(null);
const { isLoaded, loadMaps, loadMarker } = useGoogleMaps();
const { isDark: siteIsDark } = useDarkMode();

let map: google.maps.Map | null = null;
let markers: google.maps.marker.AdvancedMarkerElement[] = [];
let clusterer: InstanceType<typeof import("@googlemaps/markerclusterer").MarkerClusterer> | null = null;
let MapClass: typeof google.maps.Map;
let MarkerClass: typeof google.maps.marker.AdvancedMarkerElement;
let MarkerClustererClass: typeof import("@googlemaps/markerclusterer").MarkerClusterer | null = null;

// Days that have at least one geocoded activity (for legend)
const legendDays = computed(() =>
  props.days
    .map((d, i) => ({ ...d, colorIndex: i }))
    .filter((d) =>
      d.activities.some((a) => a.lat != null && a.lng != null)
    )
);

const hasGeocodedActivities = computed(() => legendDays.value.length > 0);

// Category filter
const hiddenTypes = ref<Set<string>>(new Set());
const uniqueTypes = computed(() => {
  const types = new Set<string>();
  for (const day of props.days) {
    for (const a of day.activities) {
      if (a.type) types.add(a.type);
    }
  }
  return Array.from(types).sort();
});

const markerColors: Record<string, string> = {
  attraction: "#3B82F6",
  restaurant: "#F97316",
  hotel: "#22C55E",
  transport: "#6B7280",
  shopping: "#A855F7",
  entertainment: "#EC4899",
};

function toggleTypeFilter(type: string) {
  if (hiddenTypes.value.has(type)) {
    hiddenTypes.value.delete(type);
  } else {
    hiddenTypes.value.add(type);
  }
  if (isLoaded.value && map) updateMarkers();
}

function createMarkerContent(dayNumber: number, color: string): HTMLElement {
  const div = document.createElement("div");
  div.style.cssText = `
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: ${color};
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  `;
  div.textContent = `D${dayNumber}`;
  return div;
}

async function initMap() {
  if (!mapContainer.value) return;
  try {
    const mapsLib = await loadMaps();
    const markerLib = await loadMarker();
    const clustererMod = await import("@googlemaps/markerclusterer");
    MapClass = mapsLib.Map;
    MarkerClass = markerLib.AdvancedMarkerElement;
    MarkerClustererClass = clustererMod.MarkerClusterer;
    createMap();
  } catch {
    // Google Maps failed to load
  }
}

function createMap() {
  if (!mapContainer.value || !MapClass) return;

  markers.forEach((m) => (m.map = null));
  markers = [];

  const mapMode = siteIsDark.value ? "dark" : "light";

  map = new MapClass(mapContainer.value, {
    zoom: 12,
    center: { lat: 0, lng: 0 },
    mapId: "trip-overview-map",
    mapTypeId: "roadmap",
    colorScheme: mapMode === "dark" ? "DARK" : "LIGHT",
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  updateMarkers();
}

function updateMarkers() {
  if (!map) return;

  if (clusterer) {
    clusterer.clearMarkers();
    clusterer = null;
  }
  markers.forEach((m) => (m.map = null));
  markers = [];

  const bounds = new google.maps.LatLngBounds();
  let hasMarkers = false;

  props.days.forEach((day, dayIndex) => {
    const color = getDayColor(dayIndex);

    day.activities
      .filter((a) => a.lat != null && a.lng != null && !hiddenTypes.value.has(a.type))
      .forEach((activity) => {
        const position = { lat: activity.lat!, lng: activity.lng! };
        bounds.extend(position);
        hasMarkers = true;

        const marker = new MarkerClass({
          map,
          position,
          content: createMarkerContent(day.dayNumber, color),
          title: `Day ${day.dayNumber}: ${activity.name}`,
        });

        markers.push(marker);
      });
  });

  if (!hasMarkers) {
    map.setCenter({ lat: 0, lng: 0 });
    map.setZoom(2);
    return;
  }

  map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });

  // Apply clustering when there are many markers
  if (MarkerClustererClass && markers.length > 10) {
    clusterer = new MarkerClustererClass({
      map,
      markers,
      renderer: {
        render({ count, position }) {
          const div = document.createElement("div");
          div.style.cssText = `
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: #E85D3A;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          `;
          div.textContent = String(count);
          return new MarkerClass({
            position,
            content: div,
          });
        },
      },
    });
  }
}

watch(
  () => props.days,
  () => {
    if (isLoaded.value && map) {
      updateMarkers();
    }
  },
  { deep: true }
);

watch(siteIsDark, () => {
  if (isLoaded.value && map) {
    createMap();
  }
});

onMounted(() => {
  initMap();
});
</script>

<template>
  <div v-if="hasGeocodedActivities" class="relative h-full">
    <div ref="mapContainer" class="h-full w-full" />

    <!-- Day legend -->
    <div
      v-if="legendDays.length > 1"
      class="absolute bottom-2 left-2 z-10 max-h-40 overflow-y-auto rounded-xl bg-white/90 px-3 py-2 shadow-md backdrop-blur-sm"
    >
      <div
        v-for="day in legendDays"
        :key="day.id"
        class="flex items-center gap-2 py-0.5 text-xs text-sand-700"
      >
        <span
          class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          :style="{ background: getDayColor(day.colorIndex) }"
        />
        Day {{ day.dayNumber }}
      </div>
    </div>

    <!-- Category filter -->
    <div
      v-if="uniqueTypes.length > 1"
      class="absolute bottom-2 right-2 z-10 flex max-w-[50%] flex-wrap justify-end gap-1"
    >
      <button
        v-for="type in uniqueTypes"
        :key="type"
        class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm transition"
        :class="hiddenTypes.has(type)
          ? 'bg-white/60 text-sand-400 line-through'
          : 'bg-white/90 text-sand-700'"
        @click="toggleTypeFilter(type)"
      >
        <span
          class="inline-block h-2 w-2 rounded-full"
          :style="{ background: hiddenTypes.has(type) ? '#d6d3d1' : (markerColors[type] || '#3B82F6') }"
        />
        {{ formatType(type) }}
      </button>
    </div>
  </div>

  <div v-else class="flex h-full items-center justify-center bg-sand-50">
    <p class="text-sm text-sand-400">No locations to display on map yet.</p>
  </div>
</template>
