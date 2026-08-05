<script setup lang="ts">
import type {
  DashboardFlight,
  DashboardPassport,
  DashboardVisaInfo,
} from "../utils/dashboard-briefing"
import {
  buildPreTripBriefing,
  getPreTripCandidate,
  getTripJourneyKind,
} from "../utils/dashboard-briefing"
import type { PassportFlight, PassportVisitedCountry } from "../utils/passport-history"

definePageMeta({ layout: "app" })
useSeoMeta({
  title: "Dashboard",
  description: "Your travel overview — trips, stats, and upcoming adventures.",
})

const { data: trips, status, refresh } = useLazyFetch("/api/trips")
const { data: upcomingFlights } = useLazyFetch("/api/flights")
const { data: visitedCountries } = useLazyFetch<PassportVisitedCountry[]>("/api/visited-countries")
const { data: passports } = useLazyFetch<DashboardPassport[]>("/api/user/passports/summary")

const { confirm } = useConfirm()

async function handleDelete(tripId: string, destination: string) {
  const ok = await confirm({
    title: "Delete trip",
    message: `Delete trip to "${destination}"? This cannot be undone.`,
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return

  try {
    await $fetch(`/api/trips/${tripId}`, { method: "DELETE" })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete trip:", e)
  }
}

function getDayCount(start: string, end: string): number {
  const s = new Date(start)
  const e = new Date(end)
  return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

// Pagination + search
const page = ref(1)
const perPage = 6
const searchQuery = ref("")

const sortedTrips = computed(() => {
  if (!trips.value) return []
  const today = new Date().toISOString().split("T")[0]!
  return [...trips.value].toSorted((a, b) => {
    // Ongoing first, then upcoming, then completed
    const statusRank = { ongoing: 0, upcoming: 1, completed: 2, cancelled: 3 } as const
    const aStatus = statusRank[getTripStatus(a.startDate, a.endDate, a.status).status]
    const bStatus = statusRank[getTripStatus(b.startDate, b.endDate, b.status).status]
    if (aStatus !== bStatus) return aStatus - bStatus
    // Within same status, sort by start date
    return a.startDate.localeCompare(b.startDate)
  })
})

const showControls = computed(() => sortedTrips.value.length > perPage)

const filteredTrips = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return sortedTrips.value
  return sortedTrips.value.filter((t) => t.destination.toLowerCase().includes(q))
})

const totalPages = computed(() => Math.ceil(filteredTrips.value.length / perPage))
const paginatedTrips = computed(() => {
  const start = (page.value - 1) * perPage
  return filteredTrips.value.slice(start, start + perPage)
})

watch(searchQuery, () => {
  page.value = 1
})

// Next upcoming flight
const today = new Date().toISOString().split("T")[0]!
interface FlightData {
  flightNumber: string
  flightDate: string
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
}

const nextFlight = computed<FlightData | null>(() => {
  if (!upcomingFlights.value) return null
  const found = (upcomingFlights.value as FlightData[]).find((f) => f.flightDate >= today)
  return found ?? null
})

// Next trip countdown — only shown when no upcoming flight, and trip has 3+ activities
const MIN_ACTIVITIES_FOR_COUNTDOWN = 3

const nextTrip = computed(() => {
  if (!trips.value) return null
  const upcoming = trips.value
    .filter((t) => t.status !== "cancelled" && t.startDate > today)
    .toSorted((a, b) => a.startDate.localeCompare(b.startDate))

  for (const trip of upcoming) {
    const activityCount = trip.days?.reduce((sum, d) => sum + (d.activities?.length ?? 0), 0) ?? 0
    if (activityCount >= MIN_ACTIVITIES_FOR_COUNTDOWN) return trip
  }
  return null
})

// Live countdown
const now = ref(new Date())
let countdownTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  // Trips are days out and the seconds unit isn't shown, so a 60s tick is
  // plenty — avoids a needless re-render every second.
  countdownTimer = setInterval(() => {
    now.value = new Date()
  }, 60_000)
})

onUnmounted(() => {
  clearInterval(countdownTimer)
})

const countdown = computed(() => {
  if (!nextTrip.value) return null
  const target = new Date(nextTrip.value.startDate + "T00:00:00")
  const diff = target.getTime() - now.value.getTime()
  if (diff <= 0) return null

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return { days, hours, minutes }
})

const defaultPassport = computed(
  () => passports.value?.find((passport) => passport.isDefault) ?? passports.value?.[0] ?? null,
)
const nextTripJourneyLabel = computed(() => {
  if (!nextTrip.value) return "Next adventure"
  const tripFlights = ((upcomingFlights.value as DashboardFlight[] | null) ?? []).filter(
    (flight) => flight.tripId === nextTrip.value?.id,
  )
  return getTripJourneyKind(tripFlights, defaultPassport.value, nextTrip.value.countryCode) ===
    "homebound"
    ? "Going home"
    : "Next adventure"
})
const visaByCountry = ref<Record<string, DashboardVisaInfo> | null>(null)
const visaPassportCode = ref<string | null>(null)

watch(
  defaultPassport,
  async (passport) => {
    if (!passport) {
      visaByCountry.value = null
      visaPassportCode.value = null
      return
    }
    if (visaPassportCode.value === passport.countryCode) return

    try {
      visaByCountry.value = await $fetch("/api/visa/check-all", {
        query: { passport: passport.countryCode },
      })
      visaPassportCode.value = passport.countryCode
    } catch (e: unknown) {
      console.error("Failed to load visa readiness:", e)
      visaByCountry.value = null
      visaPassportCode.value = null
    }
  },
  { immediate: true },
)

const preTripCandidate = computed(() =>
  getPreTripCandidate(
    trips.value ?? [],
    new Date(),
    (upcomingFlights.value as DashboardFlight[]) ?? [],
  ),
)
const dashboardBriefing = computed(() =>
  buildPreTripBriefing({
    trip: preTripCandidate.value,
    flights: (upcomingFlights.value as DashboardFlight[] | null) ?? [],
    passports: passports.value ?? [],
    visaByCountry: visaByCountry.value,
  }),
)
</script>

<template>
  <div class="flex flex-col gap-6 sm:gap-8">
    <PassportHero
      class="order-3"
      :flights="(upcomingFlights as PassportFlight[] | null) ?? []"
      :visited-countries="visitedCountries ?? []"
      :variant="dashboardBriefing ? 'slim' : 'full'"
    />

    <hr class="order-4 border-t border-sand-200/70 dark:border-white/5" />

    <PreTripBriefing v-if="dashboardBriefing" :briefing="dashboardBriefing" class="order-1" />

    <!-- Next flight + Trip countdown row -->
    <div
      v-else-if="nextFlight || (nextTrip && countdown)"
      class="order-1 grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <!-- Next flight -->
      <NuxtLink
        v-if="nextFlight"
        to="/flights"
        class="flex items-center gap-3 rounded-2xl border border-sand-200/70 bg-white/40 p-3 transition hover:border-sand-300 hover:bg-white/60 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.04] sm:gap-4 sm:p-4"
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand-100/70 text-ocean-700 dark:bg-white/5 dark:text-ocean-600 sm:h-10 sm:w-10"
        >
          <Icon name="lucide:plane" class="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-sand-500">
            Next flight
          </p>
          <p class="mt-0.5 truncate font-display text-base leading-none text-sand-900 sm:text-lg">
            {{ nextFlight.flightNumber }}
          </p>
          <p class="mt-1 truncate text-xs text-sand-500 sm:text-sm">
            {{ nextFlight.departureAirport ?? "???" }}
            &#8594;
            {{ nextFlight.arrivalAirport ?? "???" }}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-sm font-medium text-sand-900 sm:text-base">
            <NuxtTime
              v-if="nextFlight.departureTime"
              :datetime="nextFlight.departureTime"
              locale="en-US"
              hour="2-digit"
              minute="2-digit"
            />
            <template v-else>--:--</template>
          </p>
          <p class="text-[11px] text-sand-500 sm:text-xs">
            <NuxtTime
              :datetime="nextFlight.flightDate + 'T00:00:00'"
              locale="en-US"
              weekday="short"
              month="short"
              day="numeric"
            />
          </p>
        </div>
      </NuxtLink>

      <!-- Trip countdown -->
      <NuxtLink
        v-if="nextTrip && countdown"
        :to="`/trips/${nextTrip.id}`"
        class="flex items-center gap-3 rounded-2xl border border-sand-200/70 bg-white/40 p-3 transition hover:border-sand-300 hover:bg-white/60 dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.04] sm:gap-4 sm:p-4"
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand-100/70 text-terra-600 dark:bg-white/5 sm:h-10 sm:w-10"
        >
          <Icon name="lucide:map-pin" class="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-sand-500">
            {{ nextTripJourneyLabel }}
          </p>
          <p class="mt-0.5 truncate font-display text-base leading-none text-sand-900 sm:text-lg">
            {{ nextTrip.destination }}
          </p>
          <p class="mt-1 truncate text-xs text-sand-500 sm:text-sm">
            <NuxtTime
              :datetime="nextTrip.startDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
              year="numeric"
            />
          </p>
        </div>
        <div class="flex shrink-0 items-baseline gap-1 tabular-nums sm:gap-2">
          <div class="text-center">
            <p class="font-display text-sm text-sand-900 sm:text-base">{{ countdown.days }}</p>
            <p class="text-[9px] uppercase tracking-wider text-sand-500">d</p>
          </div>
          <span class="text-sand-300">:</span>
          <div class="text-center">
            <p class="font-display text-sm text-sand-900 sm:text-base">
              {{ String(countdown.hours).padStart(2, "0") }}
            </p>
            <p class="text-[9px] uppercase tracking-wider text-sand-500">h</p>
          </div>
          <span class="text-sand-300">:</span>
          <div class="text-center">
            <p class="font-display text-sm text-sand-900 sm:text-base">
              {{ String(countdown.minutes).padStart(2, "0") }}
            </p>
            <p class="text-[9px] uppercase tracking-wider text-sand-500">m</p>
          </div>
        </div>
      </NuxtLink>
    </div>

    <!-- Trips section -->
    <div class="order-5">
      <div class="flex items-center justify-between">
        <h1 class="font-display text-2xl text-sand-900 sm:text-3xl">My Trips</h1>
        <NuxtLink
          to="/trips/new"
          class="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-cta px-3.5 py-2 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-cta-hover hover:shadow-lg hover:shadow-terra-500/20 sm:gap-2 sm:px-5 sm:py-2.5"
        >
          <Icon name="lucide:plus" class="h-4 w-4" />
          <span class="hidden sm:inline">New Trip</span>
          <span class="sm:hidden">New</span>
        </NuxtLink>
      </div>

      <SkeletonDashboard v-if="status === 'pending'" />

      <div
        v-else-if="!trips?.length"
        class="mt-12 flex flex-col items-center justify-center text-center"
      >
        <div class="rounded-full bg-terra-50 p-4">
          <Icon name="lucide:map-pin" class="h-8 w-8 text-terra-400" />
        </div>
        <h2 class="mt-4 font-display text-lg text-sand-900">No trips yet</h2>
        <p class="mt-2 max-w-sm text-sm text-sand-600">
          Create your first trip and let AI plan the perfect itinerary for you.
        </p>
        <NuxtLink
          to="/trips/new"
          class="mt-6 inline-flex items-center gap-2 rounded-xl bg-cta px-6 py-3 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-cta-hover hover:shadow-lg hover:shadow-terra-500/20"
        >
          <Icon name="lucide:plus" class="h-4 w-4" />
          Create your first trip
        </NuxtLink>
      </div>

      <template v-else>
        <div v-if="showControls" class="mt-5 sm:mt-6">
          <div class="relative max-w-sm">
            <label for="trip-search" class="sr-only">Search trips by destination</label>
            <Icon
              name="lucide:search"
              class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-500"
            />
            <input
              id="trip-search"
              v-model="searchQuery"
              type="text"
              placeholder="Search by destination..."
              class="w-full rounded-xl border border-sand-200 bg-sand-50 py-2 pl-9 pr-11 text-sm text-sand-900 placeholder:text-sand-500 focus:border-terra-300 focus:outline-none focus:ring-2 focus:ring-terra-200"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="absolute right-1 top-1/2 min-h-11 min-w-11 -translate-y-1/2 inline-flex items-center justify-center rounded text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 focus-ring"
              aria-label="Clear search"
              @click="searchQuery = ''"
            >
              <Icon name="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          v-if="!filteredTrips.length"
          class="mt-8 flex flex-col items-center justify-center text-center"
        >
          <Icon name="lucide:search-x" class="h-8 w-8 text-sand-300" />
          <p class="mt-3 text-sm text-sand-600">No trips match &ldquo;{{ searchQuery }}&rdquo;.</p>
        </div>

        <div
          v-else
          class="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3"
          :class="showControls ? 'mt-4 sm:mt-5' : 'mt-5 sm:mt-6'"
        >
          <div
            v-for="trip in paginatedTrips"
            :key="trip.id"
            class="card-hover group relative rounded-2xl border border-sand-200 bg-white"
          >
            <NuxtLink :to="`/trips/${trip.id}`" class="block p-5 sm:p-6">
              <h2 class="font-display text-lg text-sand-900">
                {{ trip.destination }}
              </h2>
              <p class="mt-1 flex items-center gap-1 text-sm text-sand-500">
                <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
                <NuxtTime
                  :datetime="trip.startDate + 'T00:00:00'"
                  locale="en-US"
                  month="short"
                  day="numeric"
                />
                -
                <NuxtTime
                  :datetime="trip.endDate + 'T00:00:00'"
                  locale="en-US"
                  month="short"
                  day="numeric"
                  year="numeric"
                />
              </p>
              <div class="mt-3 flex items-center gap-2">
                <span
                  class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="getTripStatus(trip.startDate, trip.endDate, trip.status).badgeClass"
                >
                  {{ getTripStatus(trip.startDate, trip.endDate, trip.status).label }}
                </span>
                <span class="text-xs text-sand-700">
                  {{ getDayCount(trip.startDate, trip.endDate) }} days
                </span>
              </div>
            </NuxtLink>

            <button
              type="button"
              class="absolute right-2 top-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 focus-ring sm:opacity-0 sm:group-hover:opacity-100"
              :aria-label="`Delete trip to ${trip.destination}`"
              @click.stop="handleDelete(trip.id, trip.destination)"
            >
              <Icon name="lucide:trash-2" class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            :disabled="page <= 1"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-sand-200 text-sand-500 transition hover:bg-sand-50 focus-ring disabled:opacity-30"
            aria-label="Previous page"
            @click="page--"
          >
            <Icon name="lucide:chevron-left" class="h-4 w-4" />
          </button>
          <button
            v-for="p in totalPages"
            :key="p"
            type="button"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-sm font-medium transition focus-ring"
            :class="p === page ? 'bg-cta text-white' : 'text-sand-500 hover:bg-sand-50'"
            :aria-label="`Page ${p}`"
            :aria-current="p === page ? 'page' : undefined"
            @click="page = p"
          >
            {{ p }}
          </button>
          <button
            type="button"
            :disabled="page >= totalPages"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-sand-200 text-sand-500 transition hover:bg-sand-50 focus-ring disabled:opacity-30"
            aria-label="Next page"
            @click="page++"
          >
            <Icon name="lucide:chevron-right" class="h-4 w-4" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
