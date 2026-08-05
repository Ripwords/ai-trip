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

const { data: flights, status, refresh } = useLazyFetch<Flight[]>("/api/flights")

// Add flight form
const newFlightNumber = ref("")
const newFlightDate = ref("")
const adding = ref(false)

const toast = useToast()

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
    toast.error("Couldn't add flight. Please try again.")
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

const { confirm } = useConfirm()

async function deleteFlight(flightId: string) {
  const ok = await confirm({
    title: "Delete flight",
    message: "Are you sure you want to delete this flight?",
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  await $fetch(`/api/flights/${flightId}`, { method: "DELETE" })
  await refresh()
}

const today = new Date().toISOString().split("T")[0]!

function compareByDeparture(a: Flight, b: Flight): number {
  const dateCmp = a.flightDate.localeCompare(b.flightDate)
  if (dateCmp !== 0) return dateCmp
  // Same date: sort by local departure time
  if (a.departureTime && b.departureTime) {
    const aLocal = new Date(a.departureTime).toLocaleTimeString("en-US", { hour12: false })
    const bLocal = new Date(b.departureTime).toLocaleTimeString("en-US", { hour12: false })
    return aLocal.localeCompare(bLocal)
  }
  // Null times go last
  if (!a.departureTime) return 1
  if (!b.departureTime) return -1
  return 0
}

const upcomingFlights = computed(() =>
  (flights.value ?? []).filter((f) => f.flightDate >= today).toSorted(compareByDeparture),
)

const pastFlights = computed(() =>
  (flights.value ?? [])
    .filter((f) => f.flightDate < today)
    .toSorted((a, b) => -compareByDeparture(a, b)),
)

const showPast = ref(false)

const showImportModal = ref(false)
function openImportModal() {
  showImportModal.value = true
}
async function onImported() {
  await refresh()
}

// Pagination for upcoming
const upcomingPage = ref(1)
const perPage = 5
const upcomingTotalPages = computed(() => Math.ceil(upcomingFlights.value.length / perPage))
const paginatedUpcoming = computed(() => {
  const start = (upcomingPage.value - 1) * perPage
  return upcomingFlights.value.slice(start, start + perPage)
})

// Pagination for past
const pastPage = ref(1)
const pastTotalPages = computed(() => Math.ceil(pastFlights.value.length / perPage))
const paginatedPast = computed(() => {
  const start = (pastPage.value - 1) * perPage
  return pastFlights.value.slice(start, start + perPage)
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <h1 class="font-display text-2xl text-sand-900">My Flights</h1>

    <!-- Add flight form -->
    <form
      class="flex flex-col gap-3 rounded-2xl border border-sand-200 bg-white p-5 sm:flex-row sm:items-end"
      @submit.prevent="addFlight"
    >
      <div class="flex-1">
        <label for="new-flight-number" class="mb-1 block text-xs font-medium text-sand-600">
          Flight number
        </label>
        <input
          id="new-flight-number"
          v-model="newFlightNumber"
          type="text"
          placeholder="e.g. SQ638"
          class="min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-500 focus:border-terra-400 focus:outline-none"
        />
      </div>
      <div class="min-w-0 flex-1 overflow-hidden">
        <label for="new-flight-date" class="mb-1 block text-xs font-medium text-sand-600">
          Date
        </label>
        <input
          id="new-flight-date"
          v-model="newFlightDate"
          type="date"
          class="min-h-11 w-full appearance-none rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        :disabled="adding || !newFlightNumber || !newFlightDate"
        class="min-h-11 shrink-0 rounded-xl bg-cta px-5 text-sm font-medium text-white transition hover:bg-cta-hover disabled:opacity-50"
      >
        {{ adding ? "Adding..." : "Add Flight" }}
      </button>
    </form>

    <div class="flex justify-end">
      <button
        type="button"
        class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-sand-200 px-3 text-xs font-medium text-sand-700 transition hover:bg-sand-100"
        @click="openImportModal"
      >
        <Icon name="lucide:upload" class="h-3.5 w-3.5" />
        Import from Flighty
      </button>
    </div>

    <!-- Loading skeleton -->
    <SkeletonFlights v-if="status === 'pending'" />

    <!-- Upcoming flights -->
    <section v-else-if="upcomingFlights.length > 0">
      <h2 class="mb-3 text-sm font-semibold text-sand-600">
        Upcoming ({{ upcomingFlights.length }})
      </h2>
      <div class="space-y-3">
        <FlightCard
          v-for="flight in paginatedUpcoming"
          :key="flight.id"
          :flight="flight"
          show-link-to-trip
          @link-trip="linkTrip"
          @delete="deleteFlight"
        />
      </div>
      <div v-if="upcomingTotalPages > 1" class="mt-4 flex items-center justify-center gap-2">
        <button
          type="button"
          :disabled="upcomingPage <= 1"
          aria-label="Previous page"
          class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-sand-200 text-sand-500 transition hover:bg-sand-50 focus-ring disabled:opacity-30"
          @click="upcomingPage--"
        >
          <Icon name="lucide:chevron-left" class="h-4 w-4" />
        </button>
        <span class="text-xs text-sand-500">{{ upcomingPage }} / {{ upcomingTotalPages }}</span>
        <button
          type="button"
          :disabled="upcomingPage >= upcomingTotalPages"
          aria-label="Next page"
          class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-sand-200 text-sand-500 transition hover:bg-sand-50 focus-ring disabled:opacity-30"
          @click="upcomingPage++"
        >
          <Icon name="lucide:chevron-right" class="h-4 w-4" />
        </button>
      </div>
    </section>

    <!-- Empty state -->
    <div
      v-if="!flights?.length"
      class="rounded-2xl border border-dashed border-sand-300 p-12 text-center"
    >
      <Icon name="lucide:plane" class="mx-auto h-10 w-10 text-sand-300" />
      <p class="mt-3 text-sm text-sand-500">No flights yet. Add a flight above to get started.</p>
    </div>

    <!-- Past flights (collapsed) -->
    <section v-if="pastFlights.length > 0">
      <button
        class="flex items-center gap-1 text-sm font-semibold text-sand-500 transition hover:text-sand-700"
        @click="showPast = !showPast"
      >
        <Icon :name="showPast ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="h-4 w-4" />
        Past Flights ({{ pastFlights.length }})
      </button>
      <div v-if="showPast" class="mt-3 space-y-3">
        <FlightCard
          v-for="flight in paginatedPast"
          :key="flight.id"
          :flight="flight"
          show-link-to-trip
          @link-trip="linkTrip"
          @delete="deleteFlight"
        />
        <div v-if="pastTotalPages > 1" class="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            :disabled="pastPage <= 1"
            aria-label="Previous page"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-sand-200 text-sand-500 transition hover:bg-sand-50 focus-ring disabled:opacity-30"
            @click="pastPage--"
          >
            <Icon name="lucide:chevron-left" class="h-4 w-4" />
          </button>
          <span class="text-xs text-sand-500">{{ pastPage }} / {{ pastTotalPages }}</span>
          <button
            type="button"
            :disabled="pastPage >= pastTotalPages"
            aria-label="Next page"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-sand-200 text-sand-500 transition hover:bg-sand-50 focus-ring disabled:opacity-30"
            @click="pastPage++"
          >
            <Icon name="lucide:chevron-right" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>

    <ImportFlightyModal
      :open="showImportModal"
      @close="showImportModal = false"
      @imported="onImported"
    />
  </div>
</template>
