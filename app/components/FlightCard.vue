<script setup lang="ts">
import { iataToCountry } from "../utils/iata-to-country"

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

const props = defineProps<{
  flight: Flight
  trips?: { id: string; destination: string }[]
}>()

const emit = defineEmits<{
  linkTrip: [flightId: string, tripId: string | null]
  delete: [flightId: string]
}>()

const statusConfig: Record<string, { label: string; color: string }> = {
  scheduled: {
    label: "Scheduled",
    color: "bg-sand-100 text-sand-700 dark:bg-sand-800 dark:text-sand-300",
  },
  delayed: {
    label: "Delayed",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  },
  landed: {
    label: "Landed",
    color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  },
  cancelled: {
    label: "Cancelled",
    color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
}

const statusBadge = computed(
  () =>
    statusConfig[props.flight.status] ?? {
      label: "Scheduled",
      color: "bg-sand-100 text-sand-700 dark:bg-sand-800 dark:text-sand-300",
    },
)

const arrivalCountry = computed(() => {
  if (!props.flight.arrivalAirport) return null
  return iataToCountry[props.flight.arrivalAirport] ?? null
})

function formatTime(isoStr: string | null): string {
  if (!isoStr) return "--:--"
  return new Date(isoStr).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const showTripDropdown = ref(false)

function selectTrip(tripId: string | null) {
  emit("linkTrip", props.flight.id, tripId)
  showTripDropdown.value = false
}
</script>

<template>
  <div
    class="rounded-2xl border border-sand-200 bg-white p-5 transition hover:shadow-md dark:border-sand-700 dark:bg-sand-900"
  >
    <!-- Header: airline + flight number + status -->
    <div class="flex items-start justify-between">
      <div>
        <p class="text-sm text-sand-500 dark:text-sand-400">
          {{ flight.airline ?? "Unknown Airline" }}
        </p>
        <p class="font-display text-lg text-sand-900 dark:text-sand-100">
          {{ flight.flightNumber }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" :class="statusBadge.color">
          {{ statusBadge.label }}
        </span>
        <button
          class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-red-500 dark:hover:bg-sand-800"
          title="Delete flight"
          @click="emit('delete', flight.id)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Route: departure → arrival -->
    <div class="mt-4 flex items-center gap-3">
      <div class="text-center">
        <p class="font-display text-xl text-sand-900 dark:text-sand-100">
          {{ flight.departureAirport ?? "???" }}
        </p>
        <p class="text-xs text-sand-500">{{ formatTime(flight.departureTime) }}</p>
      </div>
      <div class="flex flex-1 items-center">
        <div class="h-px flex-1 bg-sand-200 dark:bg-sand-700" />
        <Icon name="lucide:plane" class="mx-2 h-4 w-4 text-sand-400" />
        <div class="h-px flex-1 bg-sand-200 dark:bg-sand-700" />
      </div>
      <div class="text-center">
        <p class="font-display text-xl text-sand-900 dark:text-sand-100">
          {{ flight.arrivalAirport ?? "???" }}
        </p>
        <p class="text-xs text-sand-500">{{ formatTime(flight.arrivalTime) }}</p>
      </div>
    </div>

    <!-- Date + terminal/gate + visa -->
    <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-sand-500 dark:text-sand-400">
      <span>{{ formatDate(flight.flightDate) }}</span>
      <span v-if="flight.terminal">· Terminal {{ flight.terminal }}</span>
      <span v-if="flight.gate">· Gate {{ flight.gate }}</span>
      <VisaBadge v-if="arrivalCountry" :destination-country="arrivalCountry" />
    </div>

    <!-- Trip link -->
    <div class="mt-3 flex items-center gap-2">
      <template v-if="flight.trip">
        <NuxtLink
          :to="`/trips/${flight.trip.id}`"
          class="inline-flex items-center gap-1 rounded-full bg-terra-50 px-2.5 py-1 text-xs font-medium text-terra-700 transition hover:bg-terra-100 dark:bg-terra-900 dark:text-terra-300"
        >
          <Icon name="lucide:map-pin" class="h-3 w-3" />
          {{ flight.trip.destination }}
        </NuxtLink>
        <button class="text-xs text-sand-400 hover:text-sand-600" @click="selectTrip(null)">
          Unlink
        </button>
      </template>
      <template v-else-if="trips && trips.length > 0">
        <div class="relative">
          <button
            class="inline-flex items-center gap-1 rounded-full border border-dashed border-sand-300 px-2.5 py-1 text-xs text-sand-500 transition hover:border-sand-400 hover:text-sand-700 dark:border-sand-600"
            @click="showTripDropdown = !showTripDropdown"
          >
            <Icon name="lucide:link" class="h-3 w-3" />
            Link to trip
          </button>
          <div
            v-if="showTripDropdown"
            class="absolute left-0 top-full z-10 mt-1 w-48 rounded-xl border border-sand-200 bg-white py-1 shadow-lg dark:border-sand-700 dark:bg-sand-800"
          >
            <button
              v-for="trip in trips"
              :key="trip.id"
              class="block w-full px-3 py-2 text-left text-xs text-sand-700 hover:bg-sand-50 dark:text-sand-300 dark:hover:bg-sand-700"
              @click="selectTrip(trip.id)"
            >
              {{ trip.destination }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
