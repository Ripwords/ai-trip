<script setup lang="ts">
interface Activity {
  id: string;
  name: string;
  type: string;
  lat: number | null;
  lng: number | null;
  sortOrder: number;
}

const props = defineProps<{
  activities: Activity[];
  showRoute?: boolean;
}>();

const emit = defineEmits<{
  markerClick: [activity: Activity];
}>();

const mapContainer = ref<HTMLElement | null>(null);
const { isLoaded, loadMaps, loadMarker } = useGoogleMaps();

let map: google.maps.Map | null = null;
let markers: google.maps.marker.AdvancedMarkerElement[] = [];
let polylines: google.maps.Polyline[] = [];

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
    const { Map } = await loadMaps();
    const { AdvancedMarkerElement } = await loadMarker();

    map = new Map(mapContainer.value, {
      zoom: 12,
      center: { lat: 0, lng: 0 },
      mapId: "trip-map",
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    updateMarkers(AdvancedMarkerElement);
  } catch {
    // Google Maps failed to load
  }
}

function updateMarkers(
  AdvancedMarkerElement?: typeof google.maps.marker.AdvancedMarkerElement
) {
  if (!map) return;

  markers.forEach((m) => (m.map = null));
  markers = [];

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

  const MarkerClass =
    AdvancedMarkerElement ?? google.maps.marker.AdvancedMarkerElement;

  const bounds = new google.maps.LatLngBounds();

  geoActivities.forEach((activity) => {
    const position = { lat: activity.lat!, lng: activity.lng! };
    bounds.extend(position);

    const marker = new MarkerClass({
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

  if (geoActivities.length === 1) {
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
    strokeColor: "#1F2937",
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
  () => props.activities,
  () => {
    if (isLoaded.value && map) {
      updateMarkers();
    }
  },
  { deep: true }
);

onMounted(() => {
  initMap();
});

defineExpose({ centerOnActivity });
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <div ref="mapContainer" class="flex-1 rounded-lg" />
  </div>
</template>
