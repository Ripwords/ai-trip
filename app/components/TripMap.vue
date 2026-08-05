<script setup lang="ts">
/// <reference types="google.maps" />
import { countryByAlpha2 } from "../data/countries"

interface Activity {
  id: string
  name: string
  type: string
  lat: number | null
  lng: number | null
  sortOrder: number
}

interface Accommodation {
  name: string | null
  lat: number | null
  lng: number | null
}

interface AirportMarker {
  code: string
  name: string | null
  lat: number
  lng: number
  variant: "arrival" | "departure"
}

const props = defineProps<{
  activities: Activity[]
  showRoute?: boolean
  // Where the day starts — previous night's accommodation
  startAccommodation?: Accommodation | null
  // Where the day ends — tonight's accommodation
  endAccommodation?: Accommodation | null
  // Airport pins to render on the first/last day of the trip
  airports?: AirportMarker[]
  // ISO 3166-1 alpha-2 country code — used to center the map on the country
  // when there are no activities/accommodation/airports yet.
  countryCode?: string | null
}>()

const emit = defineEmits<{
  markerClick: [activity: Activity]
}>()

const mapContainer = ref<HTMLElement | null>(null)
const { isLoaded, loadMaps, loadMarker } = useGoogleMaps()
const { isDark: siteIsDark } = useDarkMode()
type MapMode = "light" | "dark" | "satellite"
const mapMode = ref<MapMode>("light")

let map: google.maps.Map | null = null
let markers: google.maps.marker.AdvancedMarkerElement[] = []
let accommodationMarkers: google.maps.marker.AdvancedMarkerElement[] = []
let airportMarkers: google.maps.marker.AdvancedMarkerElement[] = []
let polylines: google.maps.Polyline[] = []
let MapClass: typeof google.maps.Map
let MarkerClass: typeof google.maps.marker.AdvancedMarkerElement

const markerColors: Record<string, string> = {
  attraction: "#3B82F6",
  restaurant: "#F97316",
  hotel: "#22C55E",
  transport: "#6B7280",
  shopping: "#A855F7",
  entertainment: "#EC4899",
}

// Category filter
const hiddenTypes = ref<Set<string>>(new Set())
const filterSheetOpen = ref(false)
const uniqueTypes = computed(() => {
  const types = new Set<string>()
  for (const a of props.activities) {
    if (a.type) types.add(a.type)
  }
  return Array.from(types).toSorted()
})

function toggleTypeFilter(type: string) {
  if (hiddenTypes.value.has(type)) {
    hiddenTypes.value.delete(type)
  } else {
    hiddenTypes.value.add(type)
  }
  if (isLoaded.value && map) updateMarkers()
}

function getMarkerColor(type: string): string {
  return markerColors[type] || "#3B82F6"
}

function createMarkerContent(index: number, type: string): HTMLElement {
  const div = document.createElement("div")
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
  `
  div.textContent = String(index + 1)
  return div
}

async function initMap() {
  if (!mapContainer.value) return

  try {
    const mapsLib = await loadMaps()
    const markerLib = await loadMarker()
    MapClass = mapsLib.Map
    MarkerClass = markerLib.AdvancedMarkerElement

    createMap()
  } catch {
    // Google Maps failed to load
  }
}

function createMap() {
  if (!mapContainer.value || !MapClass) return

  // Clean up existing
  markers.forEach((m) => (m.map = null))
  markers = []
  polylines.forEach((p) => p.setMap(null))
  polylines = []

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
    fullscreenControl: false,
  })

  updateMarkers()
}

function cycleMapMode() {
  const modes: MapMode[] = ["light", "dark", "satellite"]
  const current = modes.indexOf(mapMode.value)
  mapMode.value = modes[(current + 1) % modes.length]!
  if (import.meta.client) {
    localStorage.setItem("map-mode", mapMode.value)
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

function createAccommodationMarkerContent(variant: "previous" | "current"): HTMLElement {
  const div = document.createElement("div")
  const isPrevious = variant === "previous"
  div.style.cssText = `
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: ${isPrevious ? "#A78BFA" : "#22C55E"};
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border: 2px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    cursor: pointer;
  `
  div.innerHTML = isPrevious ? "🛏️" : "🏠"
  return div
}

function createAirportMarkerContent(airport: AirportMarker): HTMLElement {
  const wrap = document.createElement("div")
  const isArrival = airport.variant === "arrival"
  // Arrival = teal (lands here), Departure = amber (leaves here)
  const color = isArrival ? "#0EA5E9" : "#F59E0B"
  // Rotate landing icon downward, takeoff icon upward
  const rotation = isArrival ? "rotate(-45deg)" : "rotate(45deg)"
  wrap.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    transform: translateY(-10px);
  `

  const icon = document.createElement("div")
  icon.style.cssText = `
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
  `
  // Static SVG with a controlled rotation constant — no user data.
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: ${rotation};"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`

  // airport.code originates from third-party flight data — assign via
  // textContent so it can never inject HTML.
  const label = document.createElement("span")
  label.style.cssText = `
    font-size: 10px;
    font-weight: 700;
    color: ${color};
    background: white;
    padding: 1px 5px;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
    white-space: nowrap;
  `
  label.textContent = airport.code

  wrap.append(icon, label)
  return wrap
}

function sameAccommodation(
  a: Accommodation | null | undefined,
  b: Accommodation | null | undefined,
) {
  if (!a || !b) return false
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5
}

function accommodationHasPosition(
  a: Accommodation | null | undefined,
): a is Accommodation & { lat: number; lng: number } {
  return a != null && a.lat != null && a.lng != null
}

function updateMarkers(AdvancedMarkerElement?: typeof google.maps.marker.AdvancedMarkerElement) {
  if (!map) return

  markers.forEach((m) => (m.map = null))
  markers = []
  accommodationMarkers.forEach((m) => (m.map = null))
  accommodationMarkers = []
  airportMarkers.forEach((m) => (m.map = null))
  airportMarkers = []

  // props.activities is already sorted by sortOrder from the API
  // Use array index for marker numbering to match v-for index in DaySection
  const geoActivities = props.activities
    .map((a, i) => ({ ...a, displayIndex: i }))
    .filter((a) => a.lat != null && a.lng != null && !hiddenTypes.value.has(a.type))

  const MClass = AdvancedMarkerElement ?? MarkerClass
  const bounds = new google.maps.LatLngBounds()

  geoActivities.forEach((activity) => {
    const position = { lat: activity.lat!, lng: activity.lng! }
    bounds.extend(position)

    const marker = new MClass({
      map,
      position,
      content: createMarkerContent(activity.displayIndex, activity.type),
      title: activity.name,
    })

    marker.addEventListener("gmp-click", () => {
      emit("markerClick", activity)
    })

    markers.push(marker)
  })

  // Accommodation markers: show start (previous night) and end (tonight).
  // When both exist at the same place, render only the end marker to avoid overlap.
  const start = accommodationHasPosition(props.startAccommodation) ? props.startAccommodation : null
  const end = accommodationHasPosition(props.endAccommodation) ? props.endAccommodation : null
  const sameStay = sameAccommodation(start, end)

  if (start && !sameStay) {
    const pos = { lat: start.lat, lng: start.lng }
    bounds.extend(pos)
    accommodationMarkers.push(
      new MClass({
        map,
        position: pos,
        content: createAccommodationMarkerContent("previous"),
        title: start.name ? `Previous stay: ${start.name}` : "Previous stay",
      }),
    )
  }

  if (end) {
    const pos = { lat: end.lat, lng: end.lng }
    bounds.extend(pos)
    accommodationMarkers.push(
      new MClass({
        map,
        position: pos,
        content: createAccommodationMarkerContent("current"),
        title: end.name
          ? sameStay
            ? `Stay: ${end.name}`
            : `Tonight's stay: ${end.name}`
          : "Tonight's stay",
      }),
    )
  }

  // Airport markers: arrival on first day, departure on last day.
  for (const airport of props.airports ?? []) {
    const pos = { lat: airport.lat, lng: airport.lng }
    bounds.extend(pos)
    const action = airport.variant === "arrival" ? "Arriving at" : "Departing from"
    airportMarkers.push(
      new MClass({
        map,
        position: pos,
        content: createAirportMarkerContent(airport),
        title: airport.name
          ? `${action} ${airport.name} (${airport.code})`
          : `${action} ${airport.code}`,
      }),
    )
  }

  const totalPoints = geoActivities.length + accommodationMarkers.length + airportMarkers.length
  if (totalPoints === 0) {
    const country = props.countryCode ? countryByAlpha2.get(props.countryCode) : null
    if (country) {
      map.setCenter({ lat: country.lat, lng: country.lng })
      map.setZoom(country.zoom)
    } else {
      map.setCenter({ lat: 0, lng: 0 })
      map.setZoom(2)
    }
    updatePolylines()
    return
  }

  if (totalPoints === 1) {
    // Find the single point — could be an activity, accommodation, or airport.
    const onlyPoint =
      geoActivities.length === 1
        ? { lat: geoActivities[0]!.lat!, lng: geoActivities[0]!.lng! }
        : end
          ? { lat: end.lat, lng: end.lng }
          : start
            ? { lat: start.lat, lng: start.lng }
            : (props.airports ?? [])[0]
              ? { lat: (props.airports ?? [])[0]!.lat, lng: (props.airports ?? [])[0]!.lng }
              : null
    if (onlyPoint) {
      map.setCenter(onlyPoint)
      map.setZoom(15)
    } else {
      // Fallback (shouldn't happen — totalPoints===1 implies one source)
      map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
    }
  } else {
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
  }

  updatePolylines()
}

function updatePolylines() {
  polylines.forEach((p) => p.setMap(null))
  polylines = []

  if (!map || props.showRoute === false) return

  const geoActivities = props.activities
    .filter((a) => a.lat != null && a.lng != null && !hiddenTypes.value.has(a.type))
    .toSorted((a, b) => a.sortOrder - b.sortOrder)

  const start = accommodationHasPosition(props.startAccommodation) ? props.startAccommodation : null
  const end = accommodationHasPosition(props.endAccommodation) ? props.endAccommodation : null
  const sameStay = sameAccommodation(start, end)

  const path = [
    ...(start ? [{ lat: start.lat, lng: start.lng }] : []),
    ...geoActivities.map((a) => ({ lat: a.lat!, lng: a.lng! })),
    // Avoid duplicating the same coordinate at both ends when start and end match.
    ...(end && !sameStay ? [{ lat: end.lat, lng: end.lng }] : []),
  ]

  if (path.length < 2) return

  const polyline = new google.maps.Polyline({
    path,
    strokeColor: mapMode.value === "light" ? "#1F2937" : "#f7a48a",
    strokeWeight: 3,
    strokeOpacity: 0.6,
    geodesic: true,
    map,
  })

  polylines.push(polyline)
}

function centerOnActivity(activity: Activity) {
  if (!map || activity.lat == null || activity.lng == null) return
  map.panTo({ lat: activity.lat, lng: activity.lng })
  map.setZoom(16)
}

function centerOnPoint(point: { lat: number; lng: number }) {
  if (!map) return
  map.panTo({ lat: point.lat, lng: point.lng })
  map.setZoom(16)
}

watch(
  [
    () => props.activities,
    () => props.startAccommodation,
    () => props.endAccommodation,
    () => props.airports,
    () => props.countryCode,
  ],
  () => {
    if (isLoaded.value && map) {
      updateMarkers()
    }
  },
  { deep: true },
)

// Sync map with site dark mode if user hasn't manually set a map preference
watch(siteIsDark, (dark) => {
  if (import.meta.client && !localStorage.getItem("map-mode") && mapMode.value !== "satellite") {
    mapMode.value = dark ? "dark" : "light"
    createMap()
  }
})

onMounted(() => {
  if (import.meta.client) {
    const saved = localStorage.getItem("map-mode") as MapMode | null
    if (saved && ["light", "dark", "satellite"].includes(saved)) {
      mapMode.value = saved
    } else {
      // Default: follow site theme
      mapMode.value = siteIsDark.value ? "dark" : "light"
    }
  }
  initMap()
})

defineExpose({ centerOnActivity, centerOnPoint })
</script>

<template>
  <div class="relative flex h-full w-full flex-col">
    <div ref="mapContainer" class="flex-1 rounded-lg" />
    <!-- Top-right controls: map style + category filter (panel drops down) -->
    <div class="absolute right-2 top-2 z-10 flex flex-col items-end gap-1.5">
      <button
        type="button"
        class="map-btn focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 shadow-md transition"
        :aria-label="`Map style: ${mapModeLabel}. Tap to change.`"
        @click="cycleMapMode"
      >
        <Icon :name="mapModeIcon" class="h-4 w-4" />
        <span class="text-xs font-medium">{{ mapModeLabel }}</span>
      </button>

      <template v-if="uniqueTypes.length > 1">
        <button
          type="button"
          class="map-btn focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 shadow-md transition"
          :aria-expanded="filterSheetOpen"
          aria-label="Filter places by category"
          @click="filterSheetOpen = !filterSheetOpen"
        >
          <Icon name="lucide:sliders-horizontal" class="h-4 w-4" />
          <span class="text-xs font-medium">Filters</span>
        </button>
        <div
          v-if="filterSheetOpen"
          class="scrollbar-hide flex max-h-[60dvh] w-52 max-w-[75vw] flex-wrap justify-start gap-1 overflow-y-auto rounded-xl border border-sand-200 bg-sand-50/95 p-2 shadow-lg backdrop-blur"
        >
          <button
            v-for="type in uniqueTypes"
            :key="type"
            type="button"
            class="map-filter-pill focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition"
            :class="{ 'is-hidden': hiddenTypes.has(type) }"
            :aria-pressed="!hiddenTypes.has(type)"
            :aria-label="`${formatType(type)} places${hiddenTypes.has(type) ? ' (hidden)' : ''}`"
            @click="toggleTypeFilter(type)"
          >
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              :style="{
                background: hiddenTypes.has(type) ? '#78716c' : markerColors[type] || '#3B82F6',
              }"
            />
            {{ formatType(type) }}
          </button>
        </div>
      </template>
    </div>
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

.map-filter-pill {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(61, 51, 40, 0.12);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #3d3328;
}
.map-filter-pill.is-hidden {
  background: rgba(255, 255, 255, 0.5);
  color: #9f8b6f;
  text-decoration: line-through;
}

:global(.dark) .map-btn {
  background: rgba(26, 23, 20, 0.85);
  color: rgba(255, 255, 255, 0.8);
}
:global(.dark) .map-btn:hover {
  background: rgba(26, 23, 20, 0.95);
}

:global(.dark) .map-filter-pill {
  background: rgba(26, 23, 20, 0.85);
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
}
:global(.dark) .map-filter-pill.is-hidden {
  background: rgba(26, 23, 20, 0.5);
  color: rgba(255, 255, 255, 0.35);
}
</style>
