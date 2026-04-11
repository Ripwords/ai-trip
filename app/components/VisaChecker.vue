<script setup lang="ts">
import type { CountryInfo } from "../data/countries"

const props = defineProps<{
  destination: CountryInfo | null
}>()

const emit = defineEmits<{
  close: []
}>()

// Shared nationality state (synced with settings page)
const { nationality, save: saveNationality, fetch: fetchNationality } = useNationality()
onMounted(() => {
  if (!nationality.value) fetchNationality()
})

// Visa check state
const visaResult = ref<{
  visaStatus: string
  maxStayDays: number | null
  passportCountry: string
  destinationCountry: string
  isHomeCountry: boolean
} | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

// Save nationality when user changes it in the selector
const nationalityInitialized = ref(false)
watch(nationality, (val) => {
  if (!nationalityInitialized.value) {
    nationalityInitialized.value = true
    return
  }
  saveNationality(val)
})

async function checkVisa() {
  if (!nationality.value || !props.destination) return

  loading.value = true
  error.value = null
  visaResult.value = null

  try {
    const result = await $fetch("/api/visa/check", {
      query: { destination: props.destination.alpha2 },
    })
    visaResult.value = result
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Failed to check visa requirements"
  } finally {
    loading.value = false
  }
}

// Auto-check if nationality is already set when destination changes
watch([() => props.destination, nationality], ([dest, nat], [oldDest]) => {
  if (dest !== oldDest) visaResult.value = null
  if (nat && dest && !visaResult.value && !loading.value) checkVisa()
})

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  "visa-free": {
    label: "Visa Free",
    color: "text-green-600 bg-green-50 border-green-200",
    icon: "lucide:check-circle",
  },
  "visa-on-arrival": {
    label: "Visa on Arrival",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    icon: "lucide:clock",
  },
  "e-visa": {
    label: "e-Visa Required",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    icon: "lucide:globe",
  },
  "visa-required": {
    label: "Visa Required",
    color: "text-red-600 bg-red-50 border-red-200",
    icon: "lucide:shield-alert",
  },
}
</script>

<template>
  <!-- Modal backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-lg rounded-2xl border border-sand-200 bg-white shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-sand-200 px-6 py-4">
        <div>
          <h2 class="font-display text-lg text-sand-900">Visa Requirements</h2>
          <p v-if="destination" class="text-sm text-sand-500">
            Travelling to {{ destination.name }}
          </p>
        </div>
        <button
          class="rounded-lg p-2 text-sand-400 transition hover:bg-sand-100"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="space-y-4 p-6">
        <!-- Nationality selector -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-sand-700">
            Your passport nationality
          </label>
          <NationalitySelector v-model="nationality" />
        </div>

        <!-- Check button -->
        <button
          v-if="nationality && !loading && !visaResult"
          class="w-full rounded-xl bg-terra-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-terra-600"
          @click="checkVisa"
        >
          Check Visa Requirements
        </button>

        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center py-8">
          <Icon name="lucide:loader" class="h-6 w-6 animate-spin text-terra-400" />
          <span class="ml-2 text-sm text-sand-500">Checking visa requirements...</span>
        </div>

        <!-- Error -->
        <div
          v-if="error"
          class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600"
        >
          {{ error }}
        </div>

        <!-- Result -->
        <div v-if="visaResult" class="space-y-3">
          <!-- Status badge -->
          <div
            class="flex items-center gap-2 rounded-xl border px-4 py-3"
            :class="
              statusConfig[visaResult.visaStatus]?.color ??
              'text-sand-600 bg-sand-50 border-sand-200'
            "
          >
            <Icon
              :name="statusConfig[visaResult.visaStatus]?.icon ?? 'lucide:info'"
              class="h-5 w-5 shrink-0"
            />
            <span class="font-semibold">
              {{ statusConfig[visaResult.visaStatus]?.label ?? visaResult.visaStatus }}
            </span>
            <span v-if="visaResult.maxStayDays" class="ml-auto text-sm opacity-75">
              Up to {{ visaResult.maxStayDays }} days
            </span>
          </div>

          <!-- Passport / Destination info -->
          <div class="rounded-xl border border-sand-200 p-4">
            <div class="flex items-center justify-between text-sm">
              <span class="text-sand-500">Passport</span>
              <span class="font-medium text-sand-900">{{ visaResult.passportCountry }}</span>
            </div>
            <div class="mt-2 flex items-center justify-between text-sm">
              <span class="text-sand-500">Destination</span>
              <span class="font-medium text-sand-900">{{ visaResult.destinationCountry }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
