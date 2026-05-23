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
    class="passport-slim flex flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-xl border border-sand-200/70 bg-white/40 px-4 py-3 dark:border-white/5 dark:bg-white/[0.02]"
  >
    <div class="flex min-w-0 items-center gap-2">
      <p class="passport-metric-label">Travel passport</p>
      <div
        v-if="passport.countryFlags.length"
        class="flex flex-wrap items-center gap-0.5 text-base leading-none"
        aria-hidden="true"
      >
        <span
          v-for="(flag, i) in passport.countryFlags.slice(0, 10)"
          :key="passport.countries[i]?.code ?? i"
        >
          {{ flag }}
        </span>
        <span v-if="passport.countryFlags.length > 10" class="ml-1 text-xs text-sand-500">
          +{{ passport.countryFlags.length - 10 }}
        </span>
      </div>
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
            <defs>
              <pattern
                id="passport-grid"
                x="0"
                y="0"
                width="50"
                height="50"
                patternUnits="userSpaceOnUse"
              >
                <path d="M50 0H0V50" class="passport-grid-line" stroke-width="0.5" />
              </pattern>
            </defs>
            <rect width="1000" height="500" fill="url(#passport-grid)" />
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
            <span v-if="passport.countryFlags.length > 24" class="text-xs text-sand-600">
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
          class="rounded-xl bg-terra-500/15 px-3 py-2 text-xs text-terra-700"
        >
          <template v-if="flightsError">Couldn't load flights. </template>
          <template v-if="visitedError">Couldn't load visited countries.</template>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.passport-shell {
  background:
    radial-gradient(ellipse 70% 55% at 10% 0%, rgba(255, 255, 255, 0.22), transparent 62%),
    linear-gradient(115deg, transparent 38%, rgba(255, 255, 255, 0.1) 50%, transparent 62%),
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-terra-500) 13%, var(--color-sand-50)),
      color-mix(in srgb, var(--color-ocean-500) 13%, var(--color-sand-50)) 54%,
      var(--color-sand-50)
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    0 16px 42px rgba(61, 51, 40, 0.08);
  color: var(--color-sand-900);
}

.dark .passport-shell {
  background:
    radial-gradient(ellipse 70% 55% at 10% 0%, rgba(255, 255, 255, 0.06), transparent 62%),
    linear-gradient(115deg, transparent 38%, rgba(255, 255, 255, 0.035) 50%, transparent 62%),
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-terra-500) 15%, var(--color-sand-50)),
      color-mix(in srgb, var(--color-ocean-500) 16%, var(--color-sand-50)) 58%,
      var(--color-sand-50)
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 0 0 1px rgba(255, 255, 255, 0.03),
    0 18px 46px rgba(0, 0, 0, 0.28);
}

.passport-map-frame {
  background:
    radial-gradient(
      120% 80% at 0% 0%,
      color-mix(in srgb, var(--color-terra-500) 8%, transparent),
      transparent 60%
    ),
    color-mix(in srgb, var(--color-sand-50) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-terra-600) 20%, transparent);
}

.passport-metric {
  background: color-mix(in srgb, var(--color-sand-50) 62%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-sand-400) 24%, transparent);
  border-radius: 1rem;
  padding: 0.9rem 1rem;
  backdrop-filter: blur(4px);
}

.passport-metric-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-terra-600);
}

.passport-metric-value {
  font-family: ui-serif, Georgia, serif;
  font-size: 1.85rem;
  line-height: 1.1;
  color: var(--color-sand-900);
  margin-top: 0.35rem;
  word-break: break-word;
}

.passport-metric-unit {
  margin-left: 0.25rem;
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--color-sand-900) 55%, transparent);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.passport-grid-line {
  stroke: color-mix(in srgb, var(--color-sand-700) 12%, transparent);
  fill: none;
}

.passport-world-path {
  fill: color-mix(in srgb, var(--color-sand-300) 35%, transparent);
  stroke: color-mix(in srgb, var(--color-terra-600) 30%, transparent);
}

.passport-route {
  fill: none;
  stroke: var(--color-terra-600);
}

.passport-airport-dot {
  fill: var(--color-terra-700);
  stroke: color-mix(in srgb, var(--color-sand-50) 90%, transparent);
}

.passport-airport-label {
  fill: color-mix(in srgb, var(--color-terra-700) 90%, transparent);
}
</style>
