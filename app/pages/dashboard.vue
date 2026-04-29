<script setup lang="ts">
definePageMeta({ layout: "app" })
useSeoMeta({
  title: "Dashboard",
  description: "Your travel overview — trips, stats, and upcoming adventures.",
})

const { data: trips, status, refresh } = useLazyFetch("/api/trips")
const { data: stats } = useLazyFetch("/api/stats")
const { data: upcomingFlights } = useLazyFetch("/api/flights")

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

// Pagination
const page = ref(1)
const perPage = 6

const sortedTrips = computed(() => {
  if (!trips.value) return []
  const today = new Date().toISOString().split("T")[0]!
  return [...trips.value].toSorted((a, b) => {
    // Ongoing first, then upcoming, then completed
    const aStatus = a.endDate < today ? 2 : a.startDate > today ? 1 : 0
    const bStatus = b.endDate < today ? 2 : b.startDate > today ? 1 : 0
    if (aStatus !== bStatus) return aStatus - bStatus
    // Within same status, sort by start date
    return a.startDate.localeCompare(b.startDate)
  })
})

const totalPages = computed(() => Math.ceil(sortedTrips.value.length / perPage))
const paginatedTrips = computed(() => {
  const start = (page.value - 1) * perPage
  return sortedTrips.value.slice(start, start + perPage)
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
    .filter((t) => t.startDate > today)
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
  countdownTimer = setInterval(() => {
    now.value = new Date()
  }, 1000)
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
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)
  return { days, hours, minutes, seconds }
})
</script>

<template>
  <div class="space-y-6 sm:space-y-8">
    <!-- Stats strip -->
    <div v-if="stats" class="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
      <div class="rounded-xl border border-sand-200 bg-white p-3 sm:rounded-2xl sm:p-4">
        <p class="text-lg font-bold tabular-nums text-sand-900 sm:text-2xl">
          {{ stats.totalTrips }}
        </p>
        <p class="mt-0.5 text-[11px] text-sand-500 sm:text-xs">Trips</p>
      </div>
      <div class="rounded-xl border border-sand-200 bg-white p-3 sm:rounded-2xl sm:p-4">
        <p class="text-lg font-bold tabular-nums text-terra-600 sm:text-2xl">
          {{ stats.completedTrips }}
        </p>
        <p class="mt-0.5 text-[11px] text-sand-500 sm:text-xs">Completed</p>
      </div>
      <div class="rounded-xl border border-sand-200 bg-white p-3 sm:rounded-2xl sm:p-4">
        <p class="text-lg font-bold tabular-nums text-ocean-600 sm:text-2xl">
          {{ stats.countriesVisited }}
        </p>
        <p class="mt-0.5 text-[11px] text-sand-500 sm:text-xs">Countries</p>
      </div>
      <div class="rounded-xl border border-sand-200 bg-white p-3 sm:rounded-2xl sm:p-4">
        <p class="text-lg font-bold tabular-nums text-forest-600 sm:text-2xl">
          {{ stats.totalDays }}
        </p>
        <p class="mt-0.5 text-[11px] text-sand-500 sm:text-xs">Days</p>
      </div>
      <div class="rounded-xl border border-sand-200 bg-white p-3 sm:rounded-2xl sm:p-4">
        <p class="text-lg font-bold tabular-nums text-sand-900 sm:text-2xl">
          {{ stats.totalActivities }}
        </p>
        <p class="mt-0.5 text-[11px] text-sand-500 sm:text-xs">Activities</p>
      </div>
      <div class="rounded-xl border border-sand-200 bg-white p-3 sm:rounded-2xl sm:p-4">
        <p class="text-lg font-bold tabular-nums text-sand-900 sm:text-2xl">
          {{ stats.totalFlights }}
        </p>
        <p class="mt-0.5 text-[11px] text-sand-500 sm:text-xs">Flights</p>
      </div>
    </div>

    <!-- Next flight + Trip countdown row -->
    <div v-if="nextFlight || (nextTrip && countdown)" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <!-- Next flight -->
      <NuxtLink
        v-if="nextFlight"
        to="/flights"
        class="flex items-center gap-3 rounded-2xl border border-ocean-200 bg-ocean-50 p-3 transition hover:bg-ocean-100/60 sm:gap-4 sm:p-4"
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ocean-100 sm:h-10 sm:w-10"
        >
          <Icon name="lucide:plane" class="h-4 w-4 text-ocean-600 sm:h-5 sm:w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium text-ocean-600 sm:text-xs">Next flight</p>
          <p class="truncate font-display text-sand-900">
            {{ nextFlight.flightNumber }}
          </p>
          <p class="truncate text-xs text-sand-500 sm:text-sm">
            {{ nextFlight.departureAirport ?? "???" }}
            &#8594;
            {{ nextFlight.arrivalAirport ?? "???" }}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-sm font-medium text-sand-900">
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
        class="flex items-center gap-3 rounded-2xl border border-terra-200 bg-terra-50 p-3 transition hover:bg-terra-100/60 sm:gap-4 sm:p-4"
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-terra-100 sm:h-10 sm:w-10"
        >
          <Icon name="lucide:map-pin" class="h-4 w-4 text-terra-600 sm:h-5 sm:w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium text-terra-600 sm:text-xs">Next adventure</p>
          <p class="truncate font-display text-sand-900">{{ nextTrip.destination }}</p>
          <p class="text-[11px] text-sand-500 sm:text-xs">
            <NuxtTime
              :datetime="nextTrip.startDate + 'T00:00:00'"
              locale="en-US"
              month="short"
              day="numeric"
              year="numeric"
            />
          </p>
        </div>
        <div class="flex shrink-0 items-baseline gap-1.5 tabular-nums sm:gap-3">
          <div class="text-center">
            <p class="font-display text-base text-terra-600 sm:text-xl">{{ countdown.days }}</p>
            <p class="text-[10px] uppercase tracking-wider text-sand-500">d</p>
          </div>
          <span class="text-sand-300">:</span>
          <div class="text-center">
            <p class="font-display text-base text-terra-600 sm:text-xl">
              {{ String(countdown.hours).padStart(2, "0") }}
            </p>
            <p class="text-[10px] uppercase tracking-wider text-sand-500">h</p>
          </div>
          <span class="text-sand-300">:</span>
          <div class="text-center">
            <p class="font-display text-base text-terra-600 sm:text-xl">
              {{ String(countdown.minutes).padStart(2, "0") }}
            </p>
            <p class="text-[10px] uppercase tracking-wider text-sand-500">m</p>
          </div>
          <span class="hidden text-sand-300 sm:inline">:</span>
          <div class="hidden text-center sm:block">
            <p class="font-display text-base text-terra-600 sm:text-xl">
              {{ String(countdown.seconds).padStart(2, "0") }}
            </p>
            <p class="text-[10px] uppercase tracking-wider text-sand-500">s</p>
          </div>
        </div>
      </NuxtLink>
    </div>

    <!-- Trips section -->
    <div>
      <div class="flex items-center justify-between">
        <h1 class="font-display text-xl text-sand-900 sm:text-2xl">My Trips</h1>
        <NuxtLink
          to="/trips/new"
          class="inline-flex items-center gap-1.5 rounded-xl bg-terra-500 px-3.5 py-2 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-terra-600 hover:shadow-lg hover:shadow-terra-500/20 sm:gap-2 sm:px-5 sm:py-2.5"
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
          class="mt-6 inline-flex items-center gap-2 rounded-xl bg-terra-500 px-6 py-3 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-terra-600 hover:shadow-lg hover:shadow-terra-500/20"
        >
          <Icon name="lucide:plus" class="h-4 w-4" />
          Create your first trip
        </NuxtLink>
      </div>

      <template v-else>
        <div class="mt-5 grid gap-4 sm:mt-6 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
                –
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
                  :class="getTripStatus(trip.startDate, trip.endDate).badgeClass"
                >
                  {{ getTripStatus(trip.startDate, trip.endDate).label }}
                </span>
                <span class="text-xs text-sand-400">
                  {{ getDayCount(trip.startDate, trip.endDate) }} days
                </span>
              </div>
            </NuxtLink>

            <button
              class="absolute right-3 top-3 rounded p-1.5 text-sand-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              title="Delete trip"
              @click.stop="handleDelete(trip.id, trip.destination)"
            >
              <Icon name="lucide:trash-2" class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="mt-6 flex items-center justify-center gap-2">
          <button
            :disabled="page <= 1"
            class="rounded-lg border border-sand-200 p-2 text-sand-500 transition hover:bg-sand-50 disabled:opacity-30"
            @click="page--"
          >
            <Icon name="lucide:chevron-left" class="h-4 w-4" />
          </button>
          <button
            v-for="p in totalPages"
            :key="p"
            class="h-8 w-8 rounded-lg text-sm font-medium transition"
            :class="p === page ? 'bg-terra-500 text-white' : 'text-sand-500 hover:bg-sand-50'"
            @click="page = p"
          >
            {{ p }}
          </button>
          <button
            :disabled="page >= totalPages"
            class="rounded-lg border border-sand-200 p-2 text-sand-500 transition hover:bg-sand-50 disabled:opacity-30"
            @click="page++"
          >
            <Icon name="lucide:chevron-right" class="h-4 w-4" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
