<script setup lang="ts">
definePageMeta({ layout: "app" })
useSeoMeta({
  title: "Dashboard",
  description: "Your travel overview — trips, stats, and upcoming adventures.",
})

const { data: trips, status, refresh } = await useFetch("/api/trips")
const { data: stats } = await useFetch("/api/stats")
const { data: upcomingFlights } = await useFetch("/api/flights")

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

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00")
  const e = new Date(end + "T00:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`
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

function formatFlightTime(isoStr: string | null): string {
  if (!isoStr) return "--:--"
  return new Date(isoStr).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Stats strip -->
    <div v-if="stats" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div class="rounded-2xl border border-sand-200 bg-white p-4">
        <p class="text-2xl font-bold tabular-nums text-sand-900">{{ stats.totalTrips }}</p>
        <p class="mt-0.5 text-xs text-sand-500">Trips planned</p>
      </div>
      <div class="rounded-2xl border border-sand-200 bg-white p-4">
        <p class="text-2xl font-bold tabular-nums text-terra-600">{{ stats.completedTrips }}</p>
        <p class="mt-0.5 text-xs text-sand-500">Completed</p>
      </div>
      <div class="rounded-2xl border border-sand-200 bg-white p-4">
        <p class="text-2xl font-bold tabular-nums text-ocean-600">{{ stats.countriesVisited }}</p>
        <p class="mt-0.5 text-xs text-sand-500">Countries</p>
      </div>
      <div class="rounded-2xl border border-sand-200 bg-white p-4">
        <p class="text-2xl font-bold tabular-nums text-forest-600">{{ stats.totalDays }}</p>
        <p class="mt-0.5 text-xs text-sand-500">Days travelling</p>
      </div>
      <div class="rounded-2xl border border-sand-200 bg-white p-4">
        <p class="text-2xl font-bold tabular-nums text-sand-900">{{ stats.totalActivities }}</p>
        <p class="mt-0.5 text-xs text-sand-500">Activities</p>
      </div>
      <div class="rounded-2xl border border-sand-200 bg-white p-4">
        <p class="text-2xl font-bold tabular-nums text-sand-900">{{ stats.totalFlights }}</p>
        <p class="mt-0.5 text-xs text-sand-500">Flights</p>
      </div>
    </div>

    <!-- Next flight banner -->
    <div
      v-if="nextFlight"
      class="flex items-center gap-4 rounded-2xl border border-ocean-200 bg-ocean-50 p-4"
    >
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ocean-100">
        <Icon name="lucide:plane" class="h-5 w-5 text-ocean-600" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium text-ocean-600">Next flight</p>
        <p class="font-display text-sand-900">
          {{ nextFlight.flightNumber }}
        </p>
        <p class="text-sm text-sand-500">
          {{ nextFlight.departureAirport ?? "???" }}
          &#8594;
          {{ nextFlight.arrivalAirport ?? "???" }}
        </p>
      </div>
      <div class="text-right text-sm">
        <p class="font-medium text-sand-900">
          {{ formatFlightTime(nextFlight.departureTime) }}
        </p>
        <p class="text-xs text-sand-500">
          {{
            new Date(nextFlight.flightDate + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          }}
        </p>
      </div>
      <NuxtLink
        to="/flights"
        class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-ocean-600 transition hover:bg-ocean-100"
      >
        View all
      </NuxtLink>
    </div>

    <!-- Trips section -->
    <div>
      <div class="flex items-center justify-between">
        <h1 class="font-display text-2xl text-sand-900">My Trips</h1>
        <NuxtLink
          to="/trips/new"
          class="inline-flex items-center gap-2 rounded-xl bg-terra-500 px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-terra-600 hover:shadow-lg hover:shadow-terra-500/20"
        >
          <Icon name="lucide:plus" class="h-4 w-4" />
          New Trip
        </NuxtLink>
      </div>

      <div v-if="status === 'pending'" class="mt-8 text-center text-sand-500">
        <Icon name="lucide:loader" class="mx-auto h-6 w-6 animate-spin text-terra-400" />
        <p class="mt-2 text-sm">Loading trips...</p>
      </div>

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
        <div class="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="trip in paginatedTrips"
            :key="trip.id"
            class="card-hover group relative rounded-2xl border border-sand-200 bg-white"
          >
            <NuxtLink :to="`/trips/${trip.id}`" class="block p-6">
              <h2 class="font-display text-lg text-sand-900">
                {{ trip.destination }}
              </h2>
              <p class="mt-1 flex items-center gap-1 text-sm text-sand-500">
                <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
                {{ formatDateRange(trip.startDate, trip.endDate) }}
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
