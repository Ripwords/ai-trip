<script setup lang="ts">
import type { CountryInfo } from "../data/countries"
import { countryByAlpha2 } from "../data/countries"

const props = defineProps<{
  destination: CountryInfo | null
}>()

const emit = defineEmits<{
  close: []
}>()

// Close on Escape — stop propagation so the sidebar doesn't also close
function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation()
    emit("close")
  }
}
onMounted(() => document.addEventListener("keydown", handleEscape, true))
onUnmounted(() => document.removeEventListener("keydown", handleEscape, true))

// Shared nationality state (synced with settings page)
const { nationality, save: saveNationality, fetch: fetchNationality } = useNationality()
onMounted(async () => {
  // Default to user's first passport country if no nationality is set
  if (!nationality.value) {
    try {
      const passports = await $fetch("/api/user/passports")
      if (passports.length > 0) {
        nationality.value = passports[0]!.countryCode
      } else {
        await fetchNationality()
      }
    } catch {
      await fetchNationality()
    }
  }
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

// AI details state
const aiDetails = ref<{
  requirements: string
  processingTime: string | null
  cost: string | null
  notes: string | null
} | null>(null)
const aiLoading = ref(false)
const aiError = ref<string | null>(null)

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
  aiDetails.value = null
  aiError.value = null

  try {
    const result = await $fetch("/api/visa/check", {
      query: { destination: props.destination.alpha2, passport: nationality.value },
    })
    visaResult.value = result
    // Immediately start fetching AI details
    fetchAiDetails()
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Failed to check visa requirements"
  } finally {
    loading.value = false
  }
}

async function fetchAiDetails() {
  if (!visaResult.value) return

  aiLoading.value = true
  aiError.value = null

  try {
    const result = await $fetch("/api/visa/details", {
      query: {
        passport: visaResult.value.passportCountry,
        destination: visaResult.value.destinationCountry,
      },
    })
    aiDetails.value = result
  } catch {
    aiError.value = "Failed to fetch details. Please try again."
  } finally {
    aiLoading.value = false
  }
}

// Check on mount and re-check when destination or nationality changes
watch(
  [() => props.destination, nationality],
  ([dest, nat], [oldDest, oldNat]) => {
    if (oldDest !== undefined && (dest !== oldDest || nat !== oldNat)) {
      visaResult.value = null
      aiDetails.value = null
    }
    if (nat && dest && !visaResult.value && !loading.value) checkVisa()
  },
  { immediate: true },
)

const passportCountryName = computed(
  () => countryByAlpha2.get(visaResult.value?.passportCountry ?? "")?.name,
)
const destinationCountryName = computed(
  () => countryByAlpha2.get(visaResult.value?.destinationCountry ?? "")?.name,
)

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
  evisa: {
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
              <span class="font-medium text-sand-900">
                {{ passportCountryName ?? visaResult.passportCountry }}
              </span>
            </div>
            <div class="mt-2 flex items-center justify-between text-sm">
              <span class="text-sand-500">Destination</span>
              <span class="font-medium text-sand-900">
                {{ destinationCountryName ?? visaResult.destinationCountry }}
              </span>
            </div>
          </div>

          <!-- AI Details section -->
          <div v-if="aiDetails" class="overflow-hidden rounded-xl border border-sand-200">
            <!-- AI header -->
            <div class="flex items-center gap-1.5 border-b border-sand-200 bg-sand-50 px-4 py-2">
              <Icon name="lucide:sparkles" class="h-3.5 w-3.5 text-terra-400" />
              <span class="text-xs font-medium text-sand-500">AI Summary</span>
            </div>

            <div class="space-y-3 p-4">
              <!-- Requirements -->
              <p class="text-sm leading-relaxed text-sand-800">{{ aiDetails.requirements }}</p>

              <!-- Meta pills -->
              <div v-if="aiDetails.cost || aiDetails.processingTime" class="flex flex-wrap gap-2">
                <span
                  v-if="aiDetails.cost"
                  class="inline-flex items-center gap-1 rounded-lg bg-sand-100 px-2.5 py-1 text-xs text-sand-600"
                >
                  <Icon name="lucide:wallet" class="h-3 w-3" />
                  {{ aiDetails.cost }}
                </span>
                <span
                  v-if="aiDetails.processingTime"
                  class="inline-flex items-center gap-1 rounded-lg bg-sand-100 px-2.5 py-1 text-xs text-sand-600"
                >
                  <Icon name="lucide:clock" class="h-3 w-3" />
                  {{ aiDetails.processingTime }}
                </span>
              </div>

              <!-- Notes -->
              <p
                v-if="aiDetails.notes"
                class="rounded-lg bg-sand-50 p-3 text-xs leading-relaxed text-sand-500"
              >
                {{ aiDetails.notes }}
              </p>
            </div>

            <!-- Disclaimer -->
            <div class="flex items-start gap-1.5 border-t border-sand-100 bg-sand-50/50 px-4 py-2">
              <Icon name="lucide:info" class="mt-px h-3 w-3 shrink-0 text-sand-300" />
              <p class="text-[11px] leading-snug text-sand-400">
                AI-generated from web search. Always verify with official embassy or immigration
                sources before travelling.
              </p>
            </div>
          </div>

          <!-- AI Details loading -->
          <div v-else-if="aiLoading" class="overflow-hidden rounded-xl border border-sand-200">
            <div class="flex items-center gap-1.5 border-b border-sand-200 bg-sand-50 px-4 py-2">
              <Icon name="lucide:sparkles" class="h-3.5 w-3.5 text-terra-400" />
              <span class="text-xs font-medium text-sand-500">AI Summary</span>
            </div>
            <div class="space-y-2.5 p-4">
              <div class="h-3.5 w-full animate-pulse rounded bg-sand-100" />
              <div class="h-3.5 w-5/6 animate-pulse rounded bg-sand-100" />
              <div class="h-3.5 w-4/6 animate-pulse rounded bg-sand-100" />
              <div class="flex gap-2 pt-1">
                <div class="h-6 w-20 animate-pulse rounded-lg bg-sand-100" />
                <div class="h-6 w-24 animate-pulse rounded-lg bg-sand-100" />
              </div>
            </div>
          </div>

          <!-- AI Details error -->
          <div
            v-else-if="aiError"
            class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600"
          >
            {{ aiError }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
