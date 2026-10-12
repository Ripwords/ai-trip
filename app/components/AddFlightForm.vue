<script setup lang="ts">
/**
 * The one form for adding a flight by number and date. On a trip it links the
 * new flight to that trip; on /flights it adds an unlinked flight.
 */
const props = defineProps<{
  tripId?: string
}>()

const emit = defineEmits<{
  added: []
}>()

const uid = useId()
const numberId = `${uid}-flight-number`
const dateId = `${uid}-flight-date`

const flightNumber = ref("")
const flightDate = ref("")
const adding = ref(false)

const toast = useToast()

async function addFlight() {
  if (!flightNumber.value || !flightDate.value) return
  adding.value = true
  try {
    await $fetch("/api/flights", {
      method: "POST",
      body: {
        flightNumber: flightNumber.value,
        flightDate: flightDate.value,
        tripId: props.tripId,
      },
    })
    flightNumber.value = ""
    flightDate.value = ""
    emit("added")
  } catch (e: unknown) {
    console.error("Failed to add flight:", e)
    toast.error("Could not add the flight. Check the flight number and try again.")
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <form
    class="flex flex-col gap-3 rounded-2xl border border-sand-200 bg-white p-5 sm:flex-row sm:items-end"
    @submit.prevent="addFlight"
  >
    <div class="flex-1">
      <label :for="numberId" class="mb-1 block text-xs font-medium text-sand-600">
        Flight number
      </label>
      <input
        :id="numberId"
        v-model="flightNumber"
        type="text"
        placeholder="e.g. SQ638"
        class="min-h-11 w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-500 focus:border-terra-400 focus:outline-none"
      />
    </div>
    <div class="min-w-0 flex-1 overflow-hidden">
      <label :for="dateId" class="mb-1 block text-xs font-medium text-sand-600">Date</label>
      <input
        :id="dateId"
        v-model="flightDate"
        type="date"
        class="min-h-11 w-full appearance-none rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
      />
    </div>
    <button
      type="submit"
      :disabled="adding || !flightNumber || !flightDate"
      class="min-h-11 shrink-0 rounded-xl bg-cta px-5 text-sm font-medium text-white transition hover:bg-cta-hover disabled:opacity-50"
    >
      {{ adding ? "Adding..." : "Add Flight" }}
    </button>
  </form>
</template>
