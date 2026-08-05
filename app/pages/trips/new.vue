<script setup lang="ts">
import { countryByAlpha2 } from "~/data/countries"

definePageMeta({ layout: "app" })
useSeoMeta({
  title: "New Trip",
  description: "Create a new AI-powered travel itinerary with verified places from Google Maps.",
})

// Default the dates to "trip starts a week from today, lasts a week" — the
// most common shape and lets users submit without manually picking dates.
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
const defaultStart = new Date()
defaultStart.setDate(defaultStart.getDate() + 7)
const defaultEnd = new Date(defaultStart)
defaultEnd.setDate(defaultEnd.getDate() + 6)

const countryCode = ref<string | null>(null)
const showNameInput = ref(false)
const name = ref("")
const startDate = ref(toIsoDate(defaultStart))
const endDate = ref(toIsoDate(defaultEnd))
const budget = ref("")
const pace = ref("")
const currencyCode = ref("USD")
const userTouchedCurrency = ref(false)
const travelStyle = ref<string[]>([])
const error = ref("")
const loading = ref(false)

// Keep endDate ≥ startDate: if the user moves startDate past endDate, snap
// endDate forward to match. The reverse (endDate < startDate via direct edit)
// is caught by the submit-time check below.
watch(startDate, (next, prev) => {
  if (next && endDate.value && next > endDate.value) {
    endDate.value = next
  } else if (next && !endDate.value) {
    endDate.value = next
  }
  void prev
})

const rangeValid = computed(
  () => !!startDate.value && !!endDate.value && endDate.value >= startDate.value,
)

const baseCurrencies = [
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
]

// Currencies shown in the dropdown — the base 16 plus the auto-picked currency
// for the selected country if it isn't already on the list.
const currencies = computed(() => {
  const set = new Map(baseCurrencies.map((c) => [c.code, c]))
  if (currencyCode.value && !set.has(currencyCode.value)) {
    set.set(currencyCode.value, { code: currencyCode.value, label: currencyCode.value })
  }
  return [...set.values()]
})

// When the country changes, auto-update currency unless the user already
// overrode it explicitly.
watch(countryCode, (code) => {
  if (!code || userTouchedCurrency.value) return
  const c = countryByAlpha2.get(code)
  if (c) currencyCode.value = c.currency
})

function onCurrencyChange() {
  userTouchedCurrency.value = true
}

const travelStyleOptions = [
  "foodie",
  "culture",
  "adventure",
  "nature",
  "nightlife",
  "shopping",
  "relaxation",
  "photography",
]

function toggleStyle(style: string) {
  const idx = travelStyle.value.indexOf(style)
  if (idx >= 0) travelStyle.value.splice(idx, 1)
  else travelStyle.value.push(style)
}

const canSubmit = computed(() => !!countryCode.value && rangeValid.value && !loading.value)

async function handleCreate() {
  error.value = ""
  if (!countryCode.value) {
    error.value = "Please pick a country"
    return
  }
  if (!rangeValid.value) {
    error.value = "End date must be on or after start date"
    return
  }
  loading.value = true

  try {
    const trip = await $fetch("/api/trips", {
      method: "POST",
      body: {
        countryCode: countryCode.value,
        name: name.value.trim() || null,
        startDate: startDate.value,
        endDate: endDate.value,
        currencyCode: currencyCode.value,
        preferences: {
          budget: budget.value || undefined,
          pace: pace.value || undefined,
          travelStyle: travelStyle.value.length ? travelStyle.value : undefined,
        },
      },
    })

    navigateTo(`/trips/${trip!.id}`)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string }
    error.value = err.data?.message ?? err.message ?? "Failed to create trip"
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg rounded-2xl bg-white p-5 shadow-lg sm:p-8">
    <h1 class="font-display text-2xl text-sand-900">Plan a New Trip</h1>

    <form class="mt-8 space-y-5" @submit.prevent="handleCreate">
      <div>
        <label for="country" class="block text-sm font-medium text-sand-700"> Destination </label>
        <div class="mt-1.5">
          <CountryCombobox id="country" v-model="countryCode" placeholder="Pick a country" />
        </div>

        <div v-if="!showNameInput" class="mt-2">
          <button
            type="button"
            class="inline-flex min-h-11 items-center text-sm font-medium text-terra-600 hover:text-terra-700 focus-ring"
            @click="showNameInput = true"
          >
            + Add a custom name
          </button>
        </div>
        <div v-else class="mt-2">
          <label for="tripName" class="block text-sm font-medium text-sand-700">Trip name</label>
          <input
            id="tripName"
            v-model="name"
            type="text"
            maxlength="100"
            placeholder="e.g. Honeymoon 2026"
            class="form-input"
          />
        </div>
      </div>

      <div class="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
        <div>
          <label for="startDate" class="block text-sm font-medium text-sand-700">
            Start date
          </label>
          <input id="startDate" v-model="startDate" type="date" required class="form-input" />
        </div>
        <div>
          <label for="endDate" class="block text-sm font-medium text-sand-700"> End date </label>
          <input
            id="endDate"
            v-model="endDate"
            type="date"
            required
            :min="startDate || undefined"
            class="form-input"
          />
          <p v-if="!rangeValid && startDate && endDate" class="mt-1 text-xs text-red-600">
            End date must be on or after start date.
          </p>
        </div>
      </div>

      <div class="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
        <div>
          <label for="budget" class="block text-sm font-medium text-sand-700"> Budget </label>
          <select id="budget" v-model="budget" class="form-input">
            <option value="">Any</option>
            <option value="budget">Budget</option>
            <option value="moderate">Moderate</option>
            <option value="luxury">Luxury</option>
          </select>
        </div>
        <div>
          <label for="pace" class="block text-sm font-medium text-sand-700"> Pace </label>
          <select id="pace" v-model="pace" class="form-input">
            <option value="">Any</option>
            <option value="relaxed">Relaxed</option>
            <option value="moderate">Moderate</option>
            <option value="packed">Packed</option>
          </select>
        </div>
      </div>

      <!-- Currency -->
      <div>
        <label for="currency" class="block text-sm font-medium text-sand-700">Currency</label>
        <select id="currency" v-model="currencyCode" class="form-input" @change="onCurrencyChange">
          <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.label }}</option>
        </select>
      </div>

      <!-- Travel style -->
      <div>
        <label class="block text-sm font-medium text-sand-700">Travel Style</label>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="style in travelStyleOptions"
            :key="style"
            type="button"
            :aria-pressed="travelStyle.includes(style)"
            class="inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-medium capitalize transition focus-ring"
            :class="
              travelStyle.includes(style)
                ? 'border-terra-400 bg-terra-50 text-terra-700'
                : 'border-sand-200 bg-sand-50 text-sand-600 hover:border-sand-300'
            "
            @click="toggleStyle(style)"
          >
            {{ style }}
          </button>
        </div>
      </div>

      <p v-if="error" role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {{ error }}
      </p>

      <button
        type="submit"
        :disabled="!canSubmit"
        :aria-busy="loading"
        class="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cta px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cta-hover focus-ring disabled:opacity-50"
      >
        <Icon v-if="loading" name="lucide:loader" class="h-4 w-4 animate-spin" />
        {{ loading ? "Creating..." : "Create Trip" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.form-input {
  display: block;
  width: 100%;
  margin-top: 0.375rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-sand-300);
  border-radius: 0.75rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--color-sand-900);
  background-color: var(--color-sand-50);
  appearance: none;
  -webkit-appearance: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.form-input:focus {
  border-color: var(--color-terra-400);
  box-shadow: 0 0 0 3px rgba(240, 123, 90, 0.1);
  outline: none;
}

/* Select arrow */
select.form-input {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239f8b6f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  padding-right: 2.5rem;
}

input[type="date"].form-input::-webkit-datetime-edit {
  width: 100%;
}

input[type="date"].form-input::-webkit-calendar-picker-indicator {
  margin-left: auto;
}
</style>
