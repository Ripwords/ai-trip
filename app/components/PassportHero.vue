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

const props = withDefaults(
  defineProps<{
    flights: PassportFlight[]
    visitedCountries: PassportVisitedCountry[]
    year?: number | null
    flightsError?: boolean
    visitedError?: boolean
    variant?: "full" | "slim"
  }>(),
  {
    year: null,
    flightsError: false,
    visitedError: false,
    variant: "full",
  },
)

const passport = computed(() =>
  buildPassportHistory({
    flights: props.flights,
    visitedCountries: props.visitedCountries,
    year: props.year ?? null,
    recentFlightLimit: 4,
  }),
)

const formattedDistance = computed(() =>
  new Intl.NumberFormat("en-US").format(passport.value.totalDistanceKm),
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
  <section
    v-if="variant === 'slim'"
    class="passport-slim flex flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-xl border border-sand-200/70 bg-white/40 px-4 py-3 dark:border-white/5 dark:bg-sand-100"
  >
    <div class="flex min-w-0 items-center gap-2">
      <p class="passport-metric-label">Travel history</p>
      <span v-if="passport.countryFlags.length" class="text-base text-sand-900" aria-hidden="true">
        {{ passport.countryFlags.slice(0, 10).join(" ") }}
        <span v-if="passport.countryFlags.length > 10" class="ml-1 text-xs text-sand-500">
          +{{ passport.countryFlags.length - 10 }}
        </span>
      </span>
    </div>
    <dl class="flex flex-wrap items-baseline gap-x-5 gap-y-1 tabular-nums">
      <div class="flex items-baseline gap-1.5">
        <dt class="passport-metric-label">Flights</dt>
        <dd class="text-sm font-semibold text-sand-900">{{ passport.totalFlights }}</dd>
      </div>
      <div class="flex items-baseline gap-1.5">
        <dt class="passport-metric-label">Countries</dt>
        <dd class="text-sm font-semibold text-sand-900">{{ passport.countries.length }}</dd>
      </div>
      <div class="flex items-baseline gap-1.5">
        <dt class="passport-metric-label">Distance</dt>
        <dd class="text-sm font-semibold text-sand-900">
          {{ formattedDistance
          }}<span class="ml-0.5 text-[10px] font-normal text-sand-500">km</span>
        </dd>
      </div>
    </dl>
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
            <g>
              <path
                v-for="(d, i) in worldPaths"
                :key="i"
                :d="d"
                class="passport-world-path"
                stroke-width="0.4"
              />
            </g>
            <path
              v-for="seg in projectedSegments"
              :key="seg.key"
              :d="seg.d"
              class="passport-route"
              stroke-width="1.6"
              stroke-linecap="round"
            />
            <g v-for="point in uniqueMapPoints" :key="point.code">
              <circle
                :cx="point.x"
                :cy="point.y"
                r="3.5"
                class="passport-airport-dot"
                stroke-width="0.8"
              />
              <text
                :x="point.x + 6"
                :y="point.y - 5"
                font-size="10"
                class="passport-airport-label"
                font-family="ui-monospace, SFMono-Regular, monospace"
              >
                {{ point.code }}
              </text>
            </g>
          </svg>
          <p
            v-if="passport.routeSegments.length === 0"
            class="absolute inset-x-0 bottom-3 text-center text-xs text-sand-600"
          >
            No mappable routes yet
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="passport-metric">
            <p class="passport-metric-label">
              <span class="passport-metric-icon bg-terra-50 text-terra-700"
                ><Icon name="lucide:plane" class="h-3.5 w-3.5" aria-hidden="true" /></span
              >Flights
            </p>
            <p class="passport-metric-value tabular-nums">{{ passport.totalFlights }}</p>
          </div>
          <div class="passport-metric">
            <p class="passport-metric-label">
              <span class="passport-metric-icon bg-ocean-50 text-ocean-700"
                ><Icon name="lucide:route" class="h-3.5 w-3.5" aria-hidden="true" /></span
              >Flight distance
            </p>
            <p class="passport-metric-value tabular-nums">
              {{ formattedDistance }}<span class="passport-metric-unit">km</span>
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div class="passport-metric">
          <div class="flex items-baseline justify-between">
            <p class="passport-metric-label">
              <span class="passport-metric-icon bg-forest-50 text-forest-700"
                ><Icon name="lucide:globe" class="h-3.5 w-3.5" aria-hidden="true" /></span
              >Countries
            </p>
            <p class="passport-metric-value tabular-nums">{{ passport.countries.length }}</p>
          </div>
          <p
            v-if="passport.countryFlags.length"
            class="mt-3 text-xl leading-snug text-sand-900"
            aria-hidden="true"
          >
            {{ passport.countryFlags.slice(0, 24).join(" ") }}
            <span v-if="passport.countryFlags.length > 24" class="ml-1 text-xs text-sand-600">
              +{{ passport.countryFlags.length - 24 }}
            </span>
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="passport-metric">
            <p class="passport-metric-label">
              <span class="passport-metric-icon bg-amber-50 text-amber-700"
                ><Icon name="lucide:plane-landing" class="h-3.5 w-3.5" aria-hidden="true" /></span
              >Airports
            </p>
            <p class="passport-metric-value tabular-nums">
              {{ passport.uniqueAirports.length }}
            </p>
          </div>
          <div class="passport-metric">
            <p class="passport-metric-label">
              <span class="passport-metric-icon bg-purple-50 text-purple-700"
                ><Icon name="lucide:ticket" class="h-3.5 w-3.5" aria-hidden="true" /></span
              >Airlines
            </p>
            <p class="passport-metric-value tabular-nums">
              {{ passport.uniqueAirlines.length }}
            </p>
          </div>
        </div>

        <p
          v-if="flightsError || visitedError"
          class="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <template v-if="flightsError">Couldn't load flights. </template>
          <template v-if="visitedError">Couldn't load visited countries.</template>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Google Maps card: a plain surface, a real-looking map, and colour only
   where it means something (the route and the metric icons). */
.passport-shell {
  background: var(--color-card);
  border: 1px solid var(--color-sand-200);
  box-shadow:
    0 1px 2px rgba(32, 33, 36, 0.06),
    0 2px 8px rgba(32, 33, 36, 0.05);
  color: var(--color-sand-900);
  --passport-water: #aadaff;
  --passport-land: #f8f9fa;
  --passport-border: #c4c7c5;
  --passport-route: #1a73e8;
  --passport-halo: #ffffff;
}

.dark .passport-shell {
  box-shadow: none;
  --passport-water: #1f3639;
  --passport-land: #3c3d42;
  --passport-border: #5f6368;
  --passport-route: #8ab4f8;
  --passport-halo: #1f2023;
}

.passport-map-frame {
  background: var(--passport-water);
}

.passport-metric {
  background: var(--color-sand-50);
  border-radius: 1rem;
  padding: 0.9rem 1rem;
}

.passport-metric-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-sand-600);
}

.passport-metric-icon {
  display: inline-flex;
  height: 1.75rem;
  width: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
}

.passport-metric-value {
  font-family: var(--font-display);
  font-size: 1.85rem;
  line-height: 1.1;
  color: var(--color-sand-900);
  margin-top: 0.35rem;
  word-break: break-word;
}

.passport-metric-unit {
  margin-left: 0.25rem;
  font-size: 0.8rem;
  color: var(--color-sand-600);
  font-family: var(--font-sans);
}

.passport-world-path {
  fill: var(--passport-land);
  stroke: var(--passport-border);
}

.passport-route {
  fill: none;
  stroke: var(--passport-route);
}

.passport-airport-dot {
  fill: var(--passport-halo);
  stroke: var(--passport-route);
  stroke-width: 1.6;
}

.passport-airport-label {
  fill: var(--color-sand-800);
  stroke: var(--passport-halo);
  stroke-width: 3px;
  paint-order: stroke;
}
</style>
