<script setup lang="ts">
import { geoNaturalEarth1, geoPath } from "d3-geo"
import { feature } from "topojson-client"
import type { Topology, GeometryCollection } from "topojson-specification"
import { buildPassportHistory } from "../utils/passport-history"
import type {
  PassportFlight,
  PassportRouteSegment,
  PassportVisitedCountry,
} from "../utils/passport-history"
import worldTopoJson from "../data/countries-50m.json"

definePageMeta({ layout: "app" })
useSeoMeta({
  title: "Travel Passport",
  description: "Your flights, distance, and country history in one passport view.",
})

const {
  data: flightsData,
  status: flightsStatus,
  error: flightsError,
} = useLazyFetch<PassportFlight[]>("/api/flights")

const {
  data: visitedData,
  status: visitedStatus,
  error: visitedError,
} = useLazyFetch<PassportVisitedCountry[]>("/api/visited-countries")

const selectedYear = ref<number | null>(null)

const passport = computed(() =>
  buildPassportHistory({
    flights: flightsData.value ?? [],
    visitedCountries: visitedData.value ?? [],
    year: selectedYear.value,
    recentFlightLimit: 4,
  }),
)

const isLoading = computed(
  () => flightsStatus.value === "pending" || visitedStatus.value === "pending",
)

const hasAnyData = computed(
  () => passport.value.totalFlights > 0 || passport.value.countries.length > 0,
)

const formattedDistance = computed(() =>
  new Intl.NumberFormat("en-US").format(passport.value.totalDistanceKm),
)

const periodLabel = computed(() =>
  selectedYear.value == null ? "All time" : String(selectedYear.value),
)

const MAP_WIDTH = 1000
const MAP_HEIGHT = 500
const projection = geoNaturalEarth1()
  .scale(180)
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2 + 10])
const pathGenerator = geoPath().projection(projection)

const worldData = worldTopoJson as unknown as Topology
const countriesGeo = feature(worldData, worldData.objects.countries as GeometryCollection)
const worldPaths = countriesGeo.features
  .map((f) => pathGenerator(f) ?? "")
  .filter((d) => d.length > 0)

function project(lat: number, lng: number): { x: number; y: number } | null {
  const result = projection([lng, lat])
  if (!result) return null
  return { x: result[0], y: result[1] }
}

function segmentPath(seg: PassportRouteSegment): string | null {
  const a = project(seg.from.lat, seg.from.lng)
  const b = project(seg.to.lat, seg.to.lng)
  if (!a || !b) return null
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.18
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`
}

const projectedSegments = computed(() =>
  passport.value.routeSegments
    .map((seg) => ({ key: seg.flightId, d: segmentPath(seg) }))
    .filter((s): s is { key: string; d: string } => s.d !== null),
)

const uniqueMapPoints = computed(() => {
  const map = new Map<string, { code: string; x: number; y: number }>()
  for (const seg of passport.value.routeSegments) {
    for (const p of [seg.from, seg.to]) {
      if (map.has(p.code)) continue
      const projected = project(p.lat, p.lng)
      if (!projected) continue
      map.set(p.code, { code: p.code, x: projected.x, y: projected.y })
    }
  }
  return Array.from(map.values())
})
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-terra-500">Passport</p>
        <h1 class="mt-1 font-display text-3xl text-sand-900 sm:text-4xl">Travel Passport</h1>
        <p class="mt-1 text-sm text-sand-600">{{ periodLabel }}</p>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="rounded-full border border-sand-200 px-3 py-1 text-xs font-semibold transition"
          :class="
            selectedYear == null
              ? 'bg-sand-900 text-sand-50'
              : 'bg-white/70 text-sand-700 hover:bg-sand-100'
          "
          @click="selectedYear = null"
        >
          All time
        </button>
        <button
          v-for="year in passport.availableYears"
          :key="year"
          type="button"
          class="rounded-full border border-sand-200 px-3 py-1 text-xs font-semibold transition"
          :class="
            selectedYear === year
              ? 'bg-sand-900 text-sand-50'
              : 'bg-white/70 text-sand-700 hover:bg-sand-100'
          "
          @click="selectedYear = year"
        >
          {{ year }}
        </button>
      </div>
    </header>

    <div
      v-if="isLoading && !hasAnyData"
      class="passport-shell min-h-[420px] animate-pulse rounded-3xl"
      aria-hidden="true"
    />

    <section
      v-else-if="!hasAnyData"
      class="passport-shell flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-3xl px-6 py-10 text-center"
    >
      <Icon name="lucide:stamp" class="h-8 w-8 text-terra-300" />
      <h2 class="font-display text-2xl text-sand-50">Your passport is empty</h2>
      <p class="max-w-md text-sm text-sand-300">
        Add flights or mark countries to start building your travel ledger.
      </p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <NuxtLink
          to="/flights"
          class="rounded-full bg-terra-500 px-4 py-2 text-xs font-semibold text-sand-50 transition hover:bg-terra-400"
        >
          Add flights
        </NuxtLink>
        <NuxtLink
          to="/explore"
          class="rounded-full border border-sand-50/30 px-4 py-2 text-xs font-semibold text-sand-50 transition hover:bg-sand-50/10"
        >
          Mark countries
        </NuxtLink>
      </div>
    </section>

    <section v-else class="passport-shell rounded-3xl p-5 sm:p-7">
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div class="flex flex-col gap-5">
          <div class="passport-map-frame relative overflow-hidden rounded-2xl">
            <svg
              viewBox="0 0 1000 500"
              preserveAspectRatio="xMidYMid meet"
              class="block h-auto w-full"
              role="img"
              aria-label="Route map"
            >
              <defs>
                <pattern
                  id="passport-grid"
                  x="0"
                  y="0"
                  width="50"
                  height="50"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M50 0H0V50"
                    fill="none"
                    stroke="rgba(214,193,168,0.05)"
                    stroke-width="0.5"
                  />
                </pattern>
              </defs>
              <rect width="1000" height="500" fill="url(#passport-grid)" />
              <g class="passport-world">
                <path
                  v-for="(d, i) in worldPaths"
                  :key="i"
                  :d="d"
                  fill="rgba(245,233,215,0.05)"
                  stroke="rgba(213,143,93,0.18)"
                  stroke-width="0.4"
                />
              </g>
              <path
                v-for="seg in projectedSegments"
                :key="seg.key"
                :d="seg.d"
                fill="none"
                stroke="rgba(232,170,110,0.95)"
                stroke-width="1.6"
                stroke-linecap="round"
              />
              <g v-for="point in uniqueMapPoints" :key="point.code">
                <circle
                  :cx="point.x"
                  :cy="point.y"
                  r="3.5"
                  fill="#f5d3a4"
                  stroke="rgba(33,21,17,0.6)"
                  stroke-width="0.8"
                />
                <text
                  :x="point.x + 6"
                  :y="point.y - 5"
                  font-size="10"
                  fill="rgba(245,211,164,0.95)"
                  font-family="ui-monospace, SFMono-Regular, monospace"
                >
                  {{ point.code }}
                </text>
              </g>
            </svg>
            <p
              v-if="passport.routeSegments.length === 0"
              class="absolute inset-x-0 bottom-3 text-center text-xs text-sand-300"
            >
              No mappable routes yet
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="passport-metric">
              <p class="passport-metric-label">Flights</p>
              <p class="passport-metric-value tabular-nums">{{ passport.totalFlights }}</p>
            </div>
            <div class="passport-metric">
              <p class="passport-metric-label">Flight distance</p>
              <p class="passport-metric-value tabular-nums">
                {{ formattedDistance }}<span class="passport-metric-unit">km</span>
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <div class="passport-metric">
            <div class="flex items-baseline justify-between">
              <p class="passport-metric-label">Countries</p>
              <p class="passport-metric-value tabular-nums">{{ passport.countries.length }}</p>
            </div>
            <div
              v-if="passport.countryFlags.length"
              class="mt-3 flex flex-wrap gap-1 text-xl leading-none"
              aria-hidden="true"
            >
              <span
                v-for="(flag, i) in passport.countryFlags.slice(0, 24)"
                :key="passport.countries[i]?.code ?? i"
              >
                {{ flag }}
              </span>
              <span v-if="passport.countryFlags.length > 24" class="text-xs text-sand-300">
                +{{ passport.countryFlags.length - 24 }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="passport-metric">
              <p class="passport-metric-label">Airports</p>
              <p class="passport-metric-value tabular-nums">
                {{ passport.uniqueAirports.length }}
              </p>
            </div>
            <div class="passport-metric">
              <p class="passport-metric-label">Airlines</p>
              <p class="passport-metric-value tabular-nums">
                {{ passport.uniqueAirlines.length }}
              </p>
            </div>
          </div>

          <p
            v-if="flightsError || visitedError"
            class="rounded-xl bg-terra-500/15 px-3 py-2 text-xs text-terra-100"
          >
            <template v-if="flightsError">Couldn't load flights. </template>
            <template v-if="visitedError">Couldn't load visited countries.</template>
          </p>
        </div>
      </div>
    </section>

    <section v-if="hasAnyData" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="flex max-h-[420px] flex-col rounded-2xl border border-sand-200 bg-white/70 p-5">
        <div class="mb-3 flex shrink-0 items-baseline justify-between">
          <h2 class="font-display text-lg text-sand-900">Country history</h2>
          <p class="text-xs text-sand-500">{{ passport.countries.length }} total</p>
        </div>
        <ul
          v-if="passport.countries.length"
          class="passport-scroll min-h-0 flex-1 divide-y divide-sand-100 overflow-y-auto pr-2"
        >
          <li
            v-for="country in passport.countries"
            :key="country.code"
            class="flex items-center gap-3 py-2 text-sm text-sand-800"
          >
            <span class="text-lg leading-none" aria-hidden="true">{{ country.flag }}</span>
            <span>{{ country.name }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-sand-500">No countries yet.</p>
      </div>

      <div class="rounded-2xl border border-sand-200 bg-white/70 p-5">
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="font-display text-lg text-sand-900">Recent flights</h2>
          <NuxtLink to="/flights" class="text-xs font-semibold text-terra-600 hover:text-terra-700">
            View all
          </NuxtLink>
        </div>
        <ul v-if="passport.recentFlights.length" class="divide-y divide-sand-100">
          <li
            v-for="flight in passport.recentFlights"
            :key="flight.id"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span class="flex min-w-0 items-center gap-3">
              <span class="font-mono text-xs text-sand-500">{{ flight.flightNumber }}</span>
              <span class="truncate text-sand-800">
                {{ flight.departureAirport ?? "???" }} → {{ flight.arrivalAirport ?? "???" }}
              </span>
            </span>
            <NuxtTime
              :datetime="flight.flightDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
              year="numeric"
              class="shrink-0 text-xs text-sand-500"
            />
          </li>
        </ul>
        <p v-else class="text-sm text-sand-500">No flights in this period.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.passport-shell {
  background: linear-gradient(120deg, #33211d 0%, #1d2d2b 58%, #131815 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 22px 50px rgba(0, 0, 0, 0.22);
  color: #f3e8d8;
}

.passport-map-frame {
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(213, 143, 93, 0.08), transparent 60%),
    rgba(20, 26, 26, 0.55);
  border: 1px solid rgba(213, 143, 93, 0.18);
}

.passport-metric {
  background: rgba(245, 233, 215, 0.06);
  border: 1px solid rgba(245, 233, 215, 0.1);
  border-radius: 1rem;
  padding: 0.9rem 1rem;
  backdrop-filter: blur(4px);
}

.passport-metric-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(213, 143, 93, 0.9);
}

.passport-metric-value {
  font-family: ui-serif, Georgia, serif;
  font-size: 1.85rem;
  line-height: 1.1;
  color: #f5e9d7;
  margin-top: 0.35rem;
  word-break: break-word;
}

.passport-metric-unit {
  margin-left: 0.25rem;
  font-size: 0.8rem;
  color: rgba(245, 233, 215, 0.6);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.passport-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(118, 95, 71, 0.35) transparent;
}

.passport-scroll::-webkit-scrollbar {
  width: 6px;
}

.passport-scroll::-webkit-scrollbar-thumb {
  background: rgba(118, 95, 71, 0.3);
  border-radius: 999px;
}
</style>
