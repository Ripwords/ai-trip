<script setup lang="ts">
import type { TripResponse } from "~/types/trip"

defineProps<{
  open: boolean
  trip: TripResponse
  currencyConverting: boolean
}>()

const emit = defineEmits<{
  close: []
  updatePreference: [key: string, value: string | string[]]
  changeCurrency: [newCurrency: string]
}>()

const currencies = [
  { code: "USD", label: "USD ($)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "JPY", label: "JPY (¥)" },
  { code: "KRW", label: "KRW (₩)" },
  { code: "THB", label: "THB (฿)" },
  { code: "SGD", label: "SGD (S$)" },
  { code: "AUD", label: "AUD (A$)" },
  { code: "CAD", label: "CAD (C$)" },
  { code: "MYR", label: "MYR (RM)" },
  { code: "IDR", label: "IDR (Rp)" },
  { code: "TWD", label: "TWD (NT$)" },
  { code: "VND", label: "VND (₫)" },
  { code: "PHP", label: "PHP (₱)" },
  { code: "INR", label: "INR (₹)" },
  { code: "CNY", label: "CNY (¥)" },
] as const

const transportModes = [
  { value: "driving", label: "Drive / taxi" },
  { value: "walking", label: "Walk" },
  { value: "transit", label: "Transit" },
  { value: "bicycling", label: "Bike" },
] as const

function onEsc(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close")
}

onMounted(() => {
  if (import.meta.client) document.addEventListener("keydown", onEsc)
})

onUnmounted(() => {
  if (import.meta.client) document.removeEventListener("keydown", onEsc)
})
</script>

<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-30 bg-sand-900/30 backdrop-blur-[2px] lg:hidden"
      @click="emit('close')"
    />
  </Transition>

  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="translate-y-full lg:translate-y-0 lg:translate-x-full"
    enter-to-class="translate-y-0 lg:translate-x-0"
    leave-active-class="duration-150 ease-in"
    leave-from-class="translate-y-0 lg:translate-x-0"
    leave-to-class="translate-y-full lg:translate-y-0 lg:translate-x-full"
  >
    <div
      v-if="open"
      class="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sand-200 bg-white p-5 shadow-2xl lg:bottom-auto lg:right-0 lg:top-0 lg:h-full lg:max-h-none lg:w-96 lg:rounded-none lg:rounded-l-2xl"
    >
      <div class="flex items-center justify-between">
        <h3 class="font-display text-lg text-sand-900">Trip preferences</h3>
        <button
          type="button"
          class="rounded-lg p-1 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
          aria-label="Close"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>
      <p class="mt-1 text-xs text-sand-500">AI suggestions will respect these preferences.</p>

      <div class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="block text-xs font-medium text-sand-500">Budget</label>
          <select
            :value="trip.preferences?.budget || ''"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
            @change="emit('updatePreference', 'budget', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Any</option>
            <option value="budget">Budget</option>
            <option value="moderate">Moderate</option>
            <option value="luxury">Luxury</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium text-sand-500">Pace</label>
          <select
            :value="trip.preferences?.pace || ''"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
            @change="emit('updatePreference', 'pace', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Any</option>
            <option value="relaxed">Relaxed</option>
            <option value="moderate">Moderate</option>
            <option value="packed">Packed</option>
          </select>
        </div>

        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-sand-500">Currency</label>
          <select
            :value="trip.currencyCode || 'USD'"
            :disabled="currencyConverting"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm disabled:opacity-50"
            @change="emit('changeCurrency', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.label }}</option>
          </select>
        </div>

        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-sand-500">Travel time mode</label>
          <select
            :value="trip.preferences?.transportMode || 'driving'"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
            @change="
              emit('updatePreference', 'transportMode', ($event.target as HTMLSelectElement).value)
            "
          >
            <option v-for="m in transportModes" :key="m.value" :value="m.value">
              {{ m.label }}
            </option>
          </select>
        </div>

        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-sand-500">Interests</label>
          <input
            :value="trip.preferences?.interests?.join(', ') || ''"
            type="text"
            placeholder="e.g. temples, street food, nature, nightlife"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
            @change="
              emit(
                'updatePreference',
                'interests',
                ($event.target as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            "
          />
        </div>
      </div>
    </div>
  </Transition>
</template>
