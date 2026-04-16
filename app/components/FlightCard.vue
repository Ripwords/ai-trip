<script setup lang="ts">
import { iataToCountry } from "../utils/iata-to-country"

interface Flight {
  id: string
  flightNumber: string
  flightDate: string
  airline?: string | null
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  terminal?: string | null
  gate?: string | null
  status?: string
  tripId?: string | null
  trip?: { id: string; destination: string } | null
}

const props = defineProps<{
  flight: Flight
  showLinkToTrip?: boolean
  hideVisaBadge?: boolean
}>()

const emit = defineEmits<{
  linkTrip: [flightId: string, tripId: string | null]
  delete: [flightId: string]
}>()

const statusConfig: Record<string, { label: string; color: string }> = {
  scheduled: {
    label: "Scheduled",
    color: "bg-sand-100 text-sand-700",
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
    statusConfig[props.flight.status ?? "scheduled"] ?? {
      label: "Scheduled",
      color: "bg-sand-100 text-sand-700",
    },
)

// Extract IATA airline code from flight number (e.g. "TR" from "TR638", "D7" from "D7523")
// IATA codes: 2 letters, letter+digit, or digit+letter
const airlineCode = computed(() => {
  const match = props.flight.flightNumber.match(/^([A-Z\d]{2})\d/i)
  return match?.[1]?.toUpperCase() ?? null
})

// Try primary source first, fall back to secondary
const primaryLogoFailed = ref(false)
const secondaryLogoFailed = ref(false)

const airlineLogoUrl = computed(() => {
  if (!airlineCode.value) return null
  if (!primaryLogoFailed.value) {
    return `https://airlabs.co/img/airline/m/${airlineCode.value}.png`
  }
  if (!secondaryLogoFailed.value) {
    return `https://pics.avs.io/60/60/${airlineCode.value}.png`
  }
  return null
})

function onLogoError() {
  if (!primaryLogoFailed.value) {
    primaryLogoFailed.value = true
  } else {
    secondaryLogoFailed.value = true
  }
}

const arrivalCountry = computed(() => {
  if (!props.flight.arrivalAirport) return null
  return iataToCountry[props.flight.arrivalAirport] ?? null
})

const showTripPicker = ref(false)

function onTripSelected(tripId: string) {
  emit("linkTrip", props.flight.id, tripId)
  showTripPicker.value = false
}

function unlinkTrip() {
  emit("linkTrip", props.flight.id, null)
}
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-5 transition hover:shadow-md">
    <!-- Header: airline logo + name + flight number + status -->
    <div class="flex items-start justify-between">
      <div class="flex items-center gap-3">
        <img
          v-if="airlineLogoUrl"
          :key="airlineLogoUrl"
          :src="airlineLogoUrl"
          :alt="flight.airline ?? 'Airline'"
          class="h-8 w-8 shrink-0 rounded-lg object-contain"
          @error="onLogoError"
        />
        <div
          v-else
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sand-100"
        >
          <Icon name="lucide:plane" class="h-4 w-4 text-sand-400" />
        </div>
        <div>
          <p class="text-sm text-sand-500">
            {{ flight.airline ?? "Unknown Airline" }}
          </p>
          <p class="font-display text-lg text-sand-900">
            {{ flight.flightNumber }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-full px-2.5 py-0.5 text-xs font-medium" :class="statusBadge.color">
          {{ statusBadge.label }}
        </span>
        <button
          class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-red-500"
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
        <p class="font-display text-xl text-sand-900">
          {{ flight.departureAirport ?? "???" }}
        </p>
        <p class="text-xs text-sand-500">
          <NuxtTime
            v-if="flight.departureTime"
            :datetime="flight.departureTime"
            locale="en-US"
            hour="2-digit"
            minute="2-digit"
          /><template v-else>--:--</template>
        </p>
      </div>
      <div class="flex flex-1 items-center">
        <div class="h-px flex-1 bg-sand-200" />
        <Icon name="lucide:plane" class="mx-2 h-4 w-4 text-sand-400" />
        <div class="h-px flex-1 bg-sand-200" />
      </div>
      <div class="text-center">
        <p class="font-display text-xl text-sand-900">
          {{ flight.arrivalAirport ?? "???" }}
        </p>
        <p class="text-xs text-sand-500">
          <NuxtTime
            v-if="flight.arrivalTime"
            :datetime="flight.arrivalTime"
            locale="en-US"
            hour="2-digit"
            minute="2-digit"
          /><template v-else>--:--</template>
        </p>
      </div>
    </div>

    <!-- Date + terminal/gate + visa -->
    <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-sand-500">
      <span
        ><NuxtTime
          :datetime="flight.flightDate + 'T00:00:00'"
          locale="en-US"
          weekday="short"
          month="short"
          day="numeric"
      /></span>
      <span v-if="flight.terminal">· Terminal {{ flight.terminal }}</span>
      <span v-if="flight.gate">· Gate {{ flight.gate }}</span>
      <VisaBadge v-if="arrivalCountry && !hideVisaBadge" :destination-country="arrivalCountry" />
    </div>

    <!-- Trip link -->
    <div class="mt-3 flex items-center gap-2">
      <template v-if="flight.trip">
        <NuxtLink
          :to="`/trips/${flight.trip.id}`"
          class="inline-flex items-center gap-1 rounded-full bg-terra-50 px-2.5 py-1 text-xs font-medium text-terra-700 transition hover:bg-terra-100"
        >
          <Icon name="lucide:map-pin" class="h-3 w-3" />
          {{ flight.trip.destination }}
        </NuxtLink>
        <button class="text-xs text-sand-400 hover:text-sand-600" @click="unlinkTrip">
          Unlink
        </button>
      </template>
      <template v-else-if="showLinkToTrip">
        <button
          class="inline-flex items-center gap-1 rounded-full border border-dashed border-sand-300 px-2.5 py-1 text-xs text-sand-500 transition hover:border-sand-400 hover:text-sand-700"
          @click="showTripPicker = true"
        >
          <Icon name="lucide:link" class="h-3 w-3" />
          Link to trip
        </button>
        <TripPickerModal
          :open="showTripPicker"
          @select="onTripSelected"
          @close="showTripPicker = false"
        />
      </template>
    </div>
  </div>
</template>
