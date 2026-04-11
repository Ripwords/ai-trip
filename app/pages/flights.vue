<script setup lang="ts">
definePageMeta({ layout: "app" })
useSeoMeta({
  title: "My Flights",
  description: "Track your flight details, gates, and visa requirements.",
})

interface Flight {
  id: string
  flightNumber: string
  flightDate: string
  airline: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  terminal: string | null
  gate: string | null
  status: string
  tripId: string | null
  trip?: { id: string; destination: string } | null
}

const { data: flights, refresh } = await useFetch<Flight[]>("/api/flights")
const { data: trips } = await useFetch<{ id: string; destination: string }[]>("/api/trips", {
  transform: (data: { id: string; destination: string }[]) =>
    data.map((t) => ({ id: t.id, destination: t.destination })),
})

// Add flight form
const newFlightNumber = ref("")
const newFlightDate = ref("")
const adding = ref(false)

async function addFlight() {
  if (!newFlightNumber.value || !newFlightDate.value) return
  adding.value = true
  try {
    await $fetch("/api/flights", {
      method: "POST",
      body: {
        flightNumber: newFlightNumber.value,
        flightDate: newFlightDate.value,
      },
    })
    newFlightNumber.value = ""
    newFlightDate.value = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to add flight:", e)
  } finally {
    adding.value = false
  }
}

async function linkTrip(flightId: string, tripId: string | null) {
  await $fetch(`/api/flights/${flightId}`, {
    method: "PATCH",
    body: { tripId },
  })
  await refresh()
}

async function deleteFlight(flightId: string) {
  if (!confirm("Delete this flight?")) return
  await $fetch(`/api/flights/${flightId}`, { method: "DELETE" })
  await refresh()
}

const today = new Date().toISOString().split("T")[0]!

const upcomingFlights = computed(() => (flights.value ?? []).filter((f) => f.flightDate >= today))

const pastFlights = computed(() =>
  (flights.value ?? [])
    .filter((f) => f.flightDate < today)
    .sort((a, b) => b.flightDate.localeCompare(a.flightDate)),
)

const showPast = ref(false)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <h1 class="font-display text-2xl text-sand-900 dark:text-sand-100">My Flights</h1>

    <!-- Add flight form -->
    <form
      class="flex flex-col gap-3 rounded-2xl border border-sand-200 bg-white p-5 sm:flex-row sm:items-end dark:border-sand-700 dark:bg-sand-900"
      @submit.prevent="addFlight"
    >
      <div class="flex-1">
        <label class="mb-1 block text-xs font-medium text-sand-600 dark:text-sand-400">
          Flight number
        </label>
        <input
          v-model="newFlightNumber"
          type="text"
          placeholder="e.g. SQ638"
          class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-400 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100"
        />
      </div>
      <div class="flex-1">
        <label class="mb-1 block text-xs font-medium text-sand-600 dark:text-sand-400">
          Date
        </label>
        <input
          v-model="newFlightDate"
          type="date"
          class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100"
        />
      </div>
      <button
        type="submit"
        :disabled="adding || !newFlightNumber || !newFlightDate"
        class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
      >
        {{ adding ? "Adding..." : "Add Flight" }}
      </button>
    </form>

    <!-- Upcoming flights -->
    <section v-if="upcomingFlights.length > 0">
      <h2 class="mb-3 text-sm font-semibold text-sand-600 dark:text-sand-400">
        Upcoming ({{ upcomingFlights.length }})
      </h2>
      <div class="space-y-3">
        <FlightCard
          v-for="flight in upcomingFlights"
          :key="flight.id"
          :flight="flight"
          :trips="trips ?? []"
          @link-trip="linkTrip"
          @delete="deleteFlight"
        />
      </div>
    </section>

    <!-- Empty state -->
    <div
      v-if="!flights?.length"
      class="rounded-2xl border border-dashed border-sand-300 p-12 text-center dark:border-sand-700"
    >
      <Icon name="lucide:plane" class="mx-auto h-10 w-10 text-sand-300 dark:text-sand-600" />
      <p class="mt-3 text-sm text-sand-500 dark:text-sand-400">
        No flights yet. Add a flight above to get started.
      </p>
    </div>

    <!-- Past flights (collapsed) -->
    <section v-if="pastFlights.length > 0">
      <button
        class="flex items-center gap-1 text-sm font-semibold text-sand-500 transition hover:text-sand-700 dark:text-sand-400"
        @click="showPast = !showPast"
      >
        <Icon :name="showPast ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="h-4 w-4" />
        Past Flights ({{ pastFlights.length }})
      </button>
      <div v-if="showPast" class="mt-3 space-y-3">
        <FlightCard
          v-for="flight in pastFlights"
          :key="flight.id"
          :flight="flight"
          :trips="trips ?? []"
          @link-trip="linkTrip"
          @delete="deleteFlight"
        />
      </div>
    </section>
  </div>
</template>
