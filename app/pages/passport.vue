<script setup lang="ts">
import { buildPassportHistory } from "../utils/passport-history"
import type { PassportFlight, PassportVisitedCountry } from "../utils/passport-history"
import type { RenewalPassport } from "../utils/passport-renewal"

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

// Summary endpoint on purpose — this page only displays, so it never needs the
// decrypted passport number that /api/user/passports returns.
const { data: passportDocuments, status: passportDocumentsStatus } = useLazyFetch<
  RenewalPassport[]
>("/api/user/passports/summary")

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

const periodLabel = computed(() =>
  selectedYear.value == null ? "All time" : String(selectedYear.value),
)
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display text-3xl text-sand-900 sm:text-4xl">Travel Passport</h1>
        <p class="mt-1 text-sm text-sand-600">{{ periodLabel }}</p>
      </div>

      <div v-if="passport.availableYears.length > 1" class="flex flex-wrap gap-1.5">
        <button
          type="button"
          :aria-pressed="selectedYear == null"
          class="focus-ring inline-flex min-h-11 items-center rounded-full border border-sand-200 px-4 text-xs font-semibold transition active:scale-95"
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
          :aria-pressed="selectedYear === year"
          class="focus-ring inline-flex min-h-11 items-center rounded-full border border-sand-200 px-4 text-xs font-semibold transition active:scale-95"
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

    <PassportRenewalPanel
      :passports="passportDocuments"
      :loading="passportDocumentsStatus === 'pending'"
    />

    <div
      v-if="isLoading && !hasAnyData"
      class="passport-shell min-h-[420px] animate-pulse rounded-3xl"
      aria-hidden="true"
    />

    <section
      v-else-if="!hasAnyData"
      class="passport-shell flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-3xl px-6 py-10 text-center"
    >
      <Icon name="lucide:stamp" class="passport-empty-icon h-8 w-8" />
      <h2 class="font-display text-2xl text-sand-900">Your passport is empty</h2>
      <p class="max-w-md text-sm text-sand-600">
        Add flights or mark countries to start building your passport.
      </p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <NuxtLink
          to="/flights"
          class="inline-flex min-h-11 items-center rounded-full bg-terra-500 px-4 text-xs font-semibold text-sand-50 transition hover:bg-terra-400"
        >
          Add flights
        </NuxtLink>
        <NuxtLink
          to="/explore"
          class="passport-empty-outline inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-semibold transition"
        >
          Mark countries
        </NuxtLink>
      </div>
    </section>

    <PassportHero
      v-else
      :flights="flightsData ?? []"
      :visited-countries="visitedData ?? []"
      :year="selectedYear"
      :flights-error="!!flightsError"
      :visited-error="!!visitedError"
    />

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
/* Passport shell — mirrors PreTripBriefing's terra→ocean→sand gradient.
   var(--color-sand-50) swaps between light/dark, so the same formula
   reads as warm parchment in light mode and a deep travel cover in dark. */

.passport-shell {
  background:
    /* top-left catchlight */
    radial-gradient(ellipse 70% 55% at 10% 0%, rgba(255, 255, 255, 0.22), transparent 62%),
    /* diagonal sheen band */
    linear-gradient(115deg, transparent 38%, rgba(255, 255, 255, 0.1) 50%, transparent 62%),
    /* base terra → ocean → sand */
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

.passport-empty-icon {
  color: var(--color-terra-500);
}

.passport-empty-outline {
  border-color: color-mix(in srgb, var(--color-sand-700) 35%, transparent);
  color: var(--color-sand-900);
}

.passport-empty-outline:hover {
  background: color-mix(in srgb, var(--color-sand-900) 6%, transparent);
}

.passport-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-sand-500) 45%, transparent) transparent;
}

.passport-scroll::-webkit-scrollbar {
  width: 6px;
}

.passport-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-sand-500) 40%, transparent);
  border-radius: 999px;
}
</style>
