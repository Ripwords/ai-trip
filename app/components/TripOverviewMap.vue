<script setup lang="ts">
/// <reference types="google.maps" />

interface Activity {
  id: string
  name: string
  type: string
  lat: number | null
  lng: number | null
  sortOrder: number
}

interface DayWithActivities {
  id: string
  dayNumber: number
  activities: Activity[]
}

interface AirportMarker {
  code: string
  name: string | null
  lat: number
  lng: number
  variant: "arrival" | "departure"
}

const props = defineProps<{
  days: DayWithActivities[]
  selectedDayId?: string | null
  airports?: AirportMarker[]
}>()

const DAY_COLORS = [
  "#E85D3A",
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
  "#A855F7",
  "#EC4899",
  "#14B8A6",
  "#F97316",
  "#6366F1",
  "#84CC16",
]

function getDayColor(dayIndex: number): string {
  return DAY_COLORS[dayIndex % DAY_COLORS.length]!
}

const mapContainer = ref<HTMLElement | null>(null)
const { isLoaded, loadMaps, loadMarker } = useGoogleMaps()
const { isDark: siteIsDark } = useDarkMode()

type MapMode = "light" | "dark" | "satellite"
const mapMode = ref<MapMode>("light")

let map: google.maps.Map | null = null
let markers: google.maps.marker.AdvancedMarkerElement[] = []
let airportMarkers: google.maps.marker.AdvancedMarkerElement[] = []
let clusterer: InstanceType<typeof import("@googlemaps/markerclusterer").MarkerClusterer> | null =
  null
let polylines: google.maps.Polyline[] = []
let MapClass: typeof google.maps.Map
let MarkerClass: typeof google.maps.marker.AdvancedMarkerElement
let MarkerClustererClass: typeof import("@googlemaps/markerclusterer").MarkerClusterer | null = null

// Days that have at least one geocoded activity (for legend)
const legendDays = computed(() =>
  props.days
    .map((d, i) => ({ ...d, colorIndex: i }))
    .filter((d) => d.activities.some((a) => a.lat != null && a.lng != null)),
)

const hasGeocodedActivities = computed(
  () => legendDays.value.length > 0 || (props.airports ?? []).length > 0,
)

// Category filter
const hiddenTypes = ref<Set<string>>(new Set())
const uniqueTypes = computed(() => {
  const types = new Set<string>()
  for (const day of props.days) {
    for (const a of day.activities) {
      if (a.type) types.add(a.type)
    }
  }
  return Array.from(types).toSorted()
})

const markerColors: Record<string, string> = {
  attraction: "#3B82F6",
  restaurant: "#F97316",
  hotel: "#22C55E",
  transport: "#6B7280",
  shopping: "#A855F7",
  entertainment: "#EC4899",
}

function toggleTypeFilter(type: string) {
  if (hiddenTypes.value.has(type)) {
    hiddenTypes.value.delete(type)
  } else {
    hiddenTypes.value.add(type)
  }
  if (isLoaded.value && map) updateMarkers()
}

function createAirportMarkerContent(airport: AirportMarker): HTMLElement {
  const wrap = document.createElement("div")
  const isArrival = airport.variant === "arrival"
  const color = isArrival ? "#0EA5E9" : "#F59E0B"
  const rotation = isArrival ? "rotate(-45deg)" : "rotate(45deg)"
  wrap.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    transform: translateY(-10px);
  `
  wrap.innerHTML = `
    <div style="
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: ${color};
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    ">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
        style="transform: ${rotation};">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
      </svg>
    </div>
    <span style="
      font-size: 10px;
      font-weight: 700;
      color: ${color};
      background: white;
      padding: 1px 5px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.25);
      white-space: nowrap;
    ">${airport.code}</span>
  `
  return wrap
}

function createMarkerContent(label: string, color: string, dimmed: boolean): HTMLElement {
  const div = document.createElement("div")
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
    opacity: ${dimmed ? "0.25" : "1"};
    transition: opacity 0.2s;
  `
  div.textContent = label
  return div
}

async function initMap() {
  if (!mapContainer.value) return
  try {
    const mapsLib = await loadMaps()
    const markerLib = await loadMarker()
    const clustererMod = await import("@googlemaps/markerclusterer")
    MapClass = mapsLib.Map
    MarkerClass = markerLib.AdvancedMarkerElement
    MarkerClustererClass = clustererMod.MarkerClusterer
    createMap()
  } catch {
    // Google Maps failed to load
  }
}

function createMap() {
  if (!mapContainer.value || !MapClass) return

  markers.forEach((m) => (m.map = null))
  markers = []

  map = new MapClass(mapContainer.value, {
    zoom: 12,
    center: { lat: 0, lng: 0 },
    mapId: "trip-overview-map",
    mapTypeId: mapMode.value === "satellite" ? "hybrid" : "roadmap",
    colorScheme: mapMode.value === "dark" ? "DARK" : "LIGHT",
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  })

  updateMarkers()
}

function cycleMapMode() {
  const modes: MapMode[] = ["light", "dark", "satellite"]
  const current = modes.indexOf(mapMode.value)
  mapMode.value = modes[(current + 1) % modes.length]!
  if (import.meta.client) {
    localStorage.setItem("ov-map-mode", mapMode.value)
  }
  createMap()
}

const mapModeIcon = computed(() => {
  switch (mapMode.value) {
    case "light":
      return "lucide:moon"
    case "dark":
      return "lucide:globe"
    case "satellite":
      return "lucide:sun"
  }
})

const mapModeLabel = computed(() => {
  switch (mapMode.value) {
    case "light":
      return "Dark mode"
    case "dark":
      return "Satellite"
    case "satellite":
      return "Light mode"
  }
})

function updateMarkers() {
  if (!map) return

  if (clusterer) {
    clusterer.clearMarkers()
    clusterer = null
  }
  markers.forEach((m) => (m.map = null))
  markers = []
  airportMarkers.forEach((m) => (m.map = null))
  airportMarkers = []
  polylines.forEach((p) => p.setMap(null))
  polylines = []

  const selectedDay = props.selectedDayId
  const bounds = new google.maps.LatLngBounds()
  const selectedBounds = new google.maps.LatLngBounds()
  let hasMarkers = false
  let hasSelectedMarkers = false

  props.days.forEach((day, dayIndex) => {
    const color = getDayColor(dayIndex)
    const isSelected = day.id === selectedDay
    const dimmed = !!selectedDay && !isSelected

    const geoActivities = day.activities.filter(
      (a) => a.lat != null && a.lng != null && !hiddenTypes.value.has(a.type),
    )

    geoActivities.forEach((activity, activityIndex) => {
      const position = { lat: activity.lat!, lng: activity.lng! }
      bounds.extend(position)
      hasMarkers = true

      if (isSelected) {
        selectedBounds.extend(position)
        hasSelectedMarkers = true
      }

      const label = isSelected ? String(activityIndex + 1) : `D${day.dayNumber}`
      const marker = new MarkerClass({
        map,
        position,
        content: createMarkerContent(label, color, dimmed),
        title: `Day ${day.dayNumber}: ${activity.name}`,
      })

      markers.push(marker)
    })

    // Draw polyline for selected day
    if (isSelected && geoActivities.length >= 2) {
      const path = geoActivities
        .toSorted((a, b) => a.sortOrder - b.sortOrder)
        .map((a) => ({ lat: a.lat!, lng: a.lng! }))

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: color,
        strokeWeight: 3,
        strokeOpacity: 0.8,
        geodesic: true,
        map,
      })
      polylines.push(polyline)
    }
  })

  // Airport markers (trip-wide arrival + departure). They get added regardless
  // of selectedDay so the overview always shows where the trip enters and exits.
  for (const airport of props.airports ?? []) {
    const pos = { lat: airport.lat, lng: airport.lng }
    bounds.extend(pos)
    hasMarkers = true
    const action = airport.variant === "arrival" ? "Arriving at" : "Departing from"
    airportMarkers.push(
      new MarkerClass({
        map,
        position: pos,
        content: createAirportMarkerContent(airport),
        title: airport.name
          ? `${action} ${airport.name} (${airport.code})`
          : `${action} ${airport.code}`,
      }),
    )
  }

  if (!hasMarkers) {
    map.setCenter({ lat: 0, lng: 0 })
    map.setZoom(2)
    return
  }

  // Zoom to selected day's markers, or fit all
  if (hasSelectedMarkers) {
    map.fitBounds(selectedBounds, { top: 50, right: 50, bottom: 50, left: 50 })
  } else {
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
  }

  // Apply clustering only when no day is selected and there are many markers
  if (!selectedDay && MarkerClustererClass && markers.length > 10) {
    clusterer = new MarkerClustererClass({
      map,
      markers,
      renderer: {
        render({ count, position }) {
          const div = document.createElement("div")
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
          `
          div.textContent = String(count)
          return new MarkerClass({
            position,
            content: div,
          })
        },
      },
    })
  }
}

watch(
  [() => props.days, () => props.selectedDayId, () => props.airports],
  () => {
    if (isLoaded.value && map) {
      updateMarkers()
    }
  },
  { deep: true },
)

watch(siteIsDark, (dark) => {
  if (import.meta.client && !localStorage.getItem("ov-map-mode") && mapMode.value !== "satellite") {
    mapMode.value = dark ? "dark" : "light"
    createMap()
  }
})

onMounted(() => {
  if (import.meta.client) {
    const saved = localStorage.getItem("ov-map-mode") as MapMode | null
    if (saved && ["light", "dark", "satellite"].includes(saved)) {
      mapMode.value = saved
    } else {
      mapMode.value = siteIsDark.value ? "dark" : "light"
    }
  }
  initMap()
})
</script>

<template>
  <div v-if="hasGeocodedActivities" class="relative h-full">
    <div ref="mapContainer" class="h-full w-full" />

    <!-- Map mode toggle -->
    <button
      class="map-btn absolute right-2 top-2 z-10 flex h-8 items-center gap-1.5 rounded-lg px-2.5 shadow-md transition"
      :title="mapModeLabel"
      @click="cycleMapMode"
    >
      <Icon :name="mapModeIcon" class="h-4 w-4" />
      <span class="text-xs font-medium">{{ mapModeLabel }}</span>
    </button>

    <!-- Day legend -->
    <div
      v-if="legendDays.length > 1"
      class="map-overlay absolute bottom-10 right-2 z-10 max-h-40 overflow-y-auto rounded-xl px-3 py-2 shadow-md"
    >
      <div
        v-for="day in legendDays"
        :key="day.id"
        class="map-overlay-text flex items-center gap-2 py-0.5 text-xs"
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
      class="absolute bottom-2 right-2 z-10 hidden max-w-[50%] flex-wrap justify-end gap-1 lg:flex"
    >
      <button
        v-for="type in uniqueTypes"
        :key="type"
        class="map-filter-pill flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm transition"
        :class="{ 'is-hidden': hiddenTypes.has(type) }"
        @click="toggleTypeFilter(type)"
      >
        <span
          class="inline-block h-2 w-2 rounded-full"
          :style="{
            background: hiddenTypes.has(type) ? '#78716c' : markerColors[type] || '#3B82F6',
          }"
        />
        {{ formatType(type) }}
      </button>
    </div>
  </div>

  <div v-else class="flex h-full items-center justify-center bg-sand-50">
    <p class="text-sm text-sand-400">No locations to display on map yet.</p>
  </div>
</template>

<style scoped>
.map-btn {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #3d3328;
}
.map-btn:hover {
  background: #ffffff;
}

:global(.dark) .map-btn {
  background: rgba(26, 23, 20, 0.85);
  color: rgba(255, 255, 255, 0.8);
}
:global(.dark) .map-btn:hover {
  background: rgba(26, 23, 20, 0.95);
}

.map-overlay {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.map-overlay-text {
  color: #3d3328;
}

.map-filter-pill {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #3d3328;
}
.map-filter-pill.is-hidden {
  background: rgba(255, 255, 255, 0.5);
  color: #9f8b6f;
  text-decoration: line-through;
}

:global(.dark) .map-overlay {
  background: rgba(26, 23, 20, 0.85);
}
:global(.dark) .map-overlay-text {
  color: rgba(255, 255, 255, 0.8);
}

:global(.dark) .map-filter-pill {
  background: rgba(26, 23, 20, 0.85);
  color: rgba(255, 255, 255, 0.8);
}
:global(.dark) .map-filter-pill.is-hidden {
  background: rgba(26, 23, 20, 0.5);
  color: rgba(255, 255, 255, 0.35);
}
</style>
