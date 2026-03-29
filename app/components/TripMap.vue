<script setup lang="ts">
interface Activity {
  id: string;
  name: string;
  type: string;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
}

interface Accommodation {
  name: string | null;
  lat: number | null;
  lng: number | null;
}

const props = defineProps<{
  activities: Activity[];
  showRoute?: boolean;
  accommodation?: Accommodation | null;
}>();

const emit = defineEmits<{
  markerClick: [activity: Activity];
}>();

const mapContainer = ref<HTMLElement | null>(null);
const { isLoaded, loadMaps, loadMarker } = useGoogleMaps();
const { isDark: siteIsDark } = useDarkMode();
type MapMode = "light" | "dark" | "satellite";
const mapMode = ref<MapMode>("light");

let map: google.maps.Map | null = null;
let markers: google.maps.marker.AdvancedMarkerElement[] = [];
let accommodationMarker: google.maps.marker.AdvancedMarkerElement | null = null;
let polylines: google.maps.Polyline[] = [];
let MapClass: typeof google.maps.Map;
let MarkerClass: typeof google.maps.marker.AdvancedMarkerElement;

const markerColors: Record<string, string> = {
  attraction: "#3B82F6",
  restaurant: "#F97316",
  hotel: "#22C55E",
  transport: "#6B7280",
  shopping: "#A855F7",
  entertainment: "#EC4899",
};

function getMarkerColor(type: string): string {
  return markerColors[type] || "#3B82F6";
}

function createMarkerContent(index: number, type: string): HTMLElement {
  const div = document.createElement("div");
  div.style.cssText = `
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: ${getMarkerColor(type)};
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    cursor: pointer;
  `;
  div.textContent = String(index + 1);
  return div;
}

async function initMap() {
  if (!mapContainer.value) return;

  try {
    const mapsLib = await loadMaps();
    const markerLib = await loadMarker();
    MapClass = mapsLib.Map;
    MarkerClass = markerLib.AdvancedMarkerElement;

    createMap();
  } catch {
    // Google Maps failed to load
  }
}

function createMap() {
  if (!mapContainer.value || !MapClass) return;

  // Clean up existing
  markers.forEach((m) => (m.map = null));
  markers = [];
  polylines.forEach((p) => p.setMap(null));
  polylines = [];

  map = new MapClass(mapContainer.value, {
    zoom: 12,
    center: { lat: 0, lng: 0 },
    mapId: "trip-map",
    mapTypeId: mapMode.value === "satellite" ? "hybrid" : "roadmap",
    colorScheme: mapMode.value === "dark" ? "DARK" : "LIGHT",
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  updateMarkers();
}

function cycleMapMode() {
  const modes: MapMode[] = ["light", "dark", "satellite"];
  const current = modes.indexOf(mapMode.value);
  mapMode.value = modes[(current + 1) % modes.length];
  if (import.meta.client) {
    localStorage.setItem("map-mode", mapMode.value);
  }
  createMap();
}

const mapModeIcon = computed(() => {
  switch (mapMode.value) {
    case "light": return "lucide:moon";
    case "dark": return "lucide:globe";
    case "satellite": return "lucide:sun";
  }
});

const mapModeLabel = computed(() => {
  switch (mapMode.value) {
    case "light": return "Dark mode";
    case "dark": return "Satellite";
    case "satellite": return "Light mode";
  }
});

function createAccommodationMarkerContent(): HTMLElement {
  const div = document.createElement("div");
  div.style.cssText = `
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: #22C55E;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    cursor: pointer;
  `;
  div.innerHTML = "🏠";
  return div;
}

function updateMarkers(
  AdvancedMarkerElement?: typeof google.maps.marker.AdvancedMarkerElement
) {
  if (!map) return;

  markers.forEach((m) => (m.map = null));
  markers = [];
  if (accommodationMarker) {
    accommodationMarker.map = null;
    accommodationMarker = null;
  }

  // props.activities is already sorted by sortOrder from the API
  // Use array index for marker numbering to match v-for index in DaySection
  const geoActivities = props.activities
    .map((a, i) => ({ ...a, displayIndex: i }))
    .filter((a) => a.lat != null && a.lng != null);

  if (geoActivities.length === 0) {
    map.setCenter({ lat: 0, lng: 0 });
    map.setZoom(2);
    updatePolylines();
    return;
  }

  const MClass = AdvancedMarkerElement ?? MarkerClass;

  const bounds = new google.maps.LatLngBounds();

  geoActivities.forEach((activity) => {
    const position = { lat: activity.lat!, lng: activity.lng! };
    bounds.extend(position);

    const marker = new MClass({
      map,
      position,
      content: createMarkerContent(activity.displayIndex, activity.type),
      title: activity.name,
    });

    marker.addListener("click", () => {
      emit("markerClick", activity);
    });

    markers.push(marker);
  });

  // Add accommodation marker if available
  if (props.accommodation?.lat != null && props.accommodation?.lng != null) {
    const accomPos = { lat: props.accommodation.lat, lng: props.accommodation.lng };
    bounds.extend(accomPos);
    accommodationMarker = new MClass({
      map,
      position: accomPos,
      content: createAccommodationMarkerContent(),
      title: props.accommodation.name ?? "Accommodation",
    });
  }

  if (geoActivities.length === 1 && !accommodationMarker) {
    map.setCenter({
      lat: geoActivities[0].lat!,
      lng: geoActivities[0].lng!,
    });
    map.setZoom(15);
  } else {
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
  }

  updatePolylines();
}

function updatePolylines() {
  polylines.forEach((p) => p.setMap(null));
  polylines = [];

  if (!map || props.showRoute === false) return;

  const geoActivities = props.activities
    .filter((a) => a.lat != null && a.lng != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (geoActivities.length < 2) return;

  const path = geoActivities.map((a) => ({
    lat: a.lat!,
    lng: a.lng!,
  }));

  const polyline = new google.maps.Polyline({
    path,
    strokeColor: mapMode.value === "light" ? "#1F2937" : "#f7a48a",
    strokeWeight: 3,
    strokeOpacity: 0.6,
    geodesic: true,
    map,
  });

  polylines.push(polyline);
}

function centerOnActivity(activity: Activity) {
  if (!map || activity.lat == null || activity.lng == null) return;
  map.panTo({ lat: activity.lat, lng: activity.lng });
  map.setZoom(16);
}

watch(
  [() => props.activities, () => props.accommodation],
  () => {
    if (isLoaded.value && map) {
      updateMarkers();
    }
  },
  { deep: true }
);

// Sync map with site dark mode if user hasn't manually set a map preference
watch(siteIsDark, (dark) => {
  if (!localStorage.getItem("map-mode") && mapMode.value !== "satellite") {
    mapMode.value = dark ? "dark" : "light";
    createMap();
  }
});

onMounted(() => {
  if (import.meta.client) {
    const saved = localStorage.getItem("map-mode") as MapMode | null;
    if (saved && ["light", "dark", "satellite"].includes(saved)) {
      mapMode.value = saved;
    } else {
      // Default: follow site theme
      mapMode.value = siteIsDark.value ? "dark" : "light";
    }
  }
  initMap();
});

defineExpose({ centerOnActivity });
</script>

<template>
  <div class="relative flex h-full w-full flex-col">
    <div ref="mapContainer" class="flex-1 rounded-lg" />
    <!-- Map mode toggle: Light → Dark → Satellite → Light -->
    <button
      class="absolute right-2 top-2 z-10 flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 shadow-md transition hover:bg-sand-50"
      :title="mapModeLabel"
      @click="cycleMapMode"
    >
      <Icon :name="mapModeIcon" class="h-4 w-4 text-sand-700" />
      <span class="text-xs font-medium text-sand-600">{{ mapModeLabel }}</span>
    </button>
  </div>
</template>
