<script setup lang="ts">
import type { TripResponse } from "~/types/trip"
import { TRIP_CURRENCIES } from "#shared/utils/currency"

interface DayToDelete {
  id: string
  dayNumber: number
  date: string
  activityCount: number
  activityNames: string[]
}

const props = defineProps<{
  open: boolean
  tripId: string
  trip: TripResponse
  currencyConverting: boolean
  focusField?: "country" | null
}>()

const emit = defineEmits<{
  close: []
  updatePreference: [key: string, value: string | string[]]
  changeCurrency: [newCurrency: string]
  tripInfoSaved: [payload: unknown]
}>()

// On mobile this is a modal bottom sheet over a backdrop, so the page behind it
// must not scroll under the finger.
useBodyScrollLock(() => props.open)

// Dialog semantics to match the app's other overlays: focus trap, initial
// focus, Escape-to-close and focus restore to whatever opened the sheet. This
// replaces a bare document keydown listener that handled Escape only — with a
// backdrop and a scroll lock in place, a keyboard or screen-reader user could
// otherwise tab straight out into the inert page behind.
const sheetRef = ref<HTMLElement | null>(null)
const headingId = useId()
useModalA11y(sheetRef, {
  isOpen: () => props.open,
  onClose: () => emit("close"),
})

// Shared with the per-expense currency picker — see shared/utils/currency.ts.
const currencies = TRIP_CURRENCIES

const transportModes = [
  { value: "driving", label: "Drive / taxi" },
  { value: "walking", label: "Walk" },
  { value: "transit", label: "Transit" },
  { value: "bicycling", label: "Bike" },
] as const

// Trip info form — prefill from current trip, treat opening the sheet as the
// baseline for "changed" comparisons so reopening without edits is a no-op.
const initialName = computed(() => props.trip.name ?? props.trip.destination ?? "")
const countryCode = ref<string | null>(props.trip.countryCode)
const name = ref(initialName.value)
const startDate = ref(props.trip.startDate)
const endDate = ref(props.trip.endDate)
const cancelled = ref(props.trip.status === "cancelled")
const savingTripInfo = ref(false)
const tripInfoError = ref<string | null>(null)

const countryFieldRef = ref<HTMLElement | null>(null)

const stage = ref<"settings" | "confirm-date-shrink">("settings")
const daysToDelete = ref<DayToDelete[]>([])

watch(
  () => [props.open, props.trip, props.focusField],
  () => {
    if (props.open) {
      countryCode.value = props.trip.countryCode
      name.value = initialName.value
      startDate.value = props.trip.startDate
      endDate.value = props.trip.endDate
      cancelled.value = props.trip.status === "cancelled"
      stage.value = "settings"
      tripInfoError.value = null
      if (props.focusField === "country") {
        nextTick(() => {
          countryFieldRef.value?.scrollIntoView({ behavior: "smooth", block: "center" })
        })
      }
    }
  },
  { deep: true },
)

const datesChanged = computed(
  () => startDate.value !== props.trip.startDate || endDate.value !== props.trip.endDate,
)
const countryChanged = computed(() => countryCode.value !== props.trip.countryCode)
const nameChanged = computed(() => name.value.trim() !== initialName.value)
const statusChanged = computed(() => cancelled.value !== (props.trip.status === "cancelled"))
const tripInfoChanged = computed(
  () => datesChanged.value || countryChanged.value || nameChanged.value || statusChanged.value,
)
const rangeValid = computed(() => endDate.value >= startDate.value)
const countryValid = computed(() => !countryChanged.value || !!countryCode.value)
const canSaveTripInfo = computed(
  () => tripInfoChanged.value && rangeValid.value && countryValid.value,
)

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

async function handleTripInfoSubmit() {
  tripInfoError.value = null
  if (countryChanged.value && !countryCode.value) {
    tripInfoError.value = "Please pick a country"
    return
  }
  if (!rangeValid.value) {
    tripInfoError.value = "End date must be on or after start date"
    return
  }
  if (!tripInfoChanged.value) return

  savingTripInfo.value = true
  try {
    if (datesChanged.value) {
      const preview = await $fetch<{ daysToDelete: DayToDelete[]; daysToAdd: number }>(
        `/api/trips/${props.tripId}/date-change-preview`,
        { query: { startDate: startDate.value, endDate: endDate.value } },
      )
      const destructive = preview.daysToDelete.filter((d) => d.activityCount > 0)
      if (destructive.length > 0) {
        daysToDelete.value = destructive
        stage.value = "confirm-date-shrink"
        savingTripInfo.value = false
        return
      }
    }
    await commitTripInfo()
  } catch (e) {
    tripInfoError.value = e instanceof Error ? e.message : "Failed to save changes"
  } finally {
    savingTripInfo.value = false
  }
}

async function commitTripInfo() {
  savingTripInfo.value = true
  try {
    const body: Record<string, unknown> = {}
    if (countryChanged.value && countryCode.value) body.countryCode = countryCode.value
    if (nameChanged.value) body.name = name.value.trim() || null
    if (statusChanged.value) body.status = cancelled.value ? "cancelled" : "upcoming"
    if (datesChanged.value) {
      body.startDate = startDate.value
      body.endDate = endDate.value
    }
    const result = await $fetch(`/api/trips/${props.tripId}`, { method: "PUT", body })
    emit("tripInfoSaved", result)
    stage.value = "settings"
  } catch (e) {
    tripInfoError.value = e instanceof Error ? e.message : "Failed to save changes"
    stage.value = "settings"
  } finally {
    savingTripInfo.value = false
  }
}

// Escape is handled by useModalA11y above, which also traps focus and restores
// it on close — a plain document listener did neither, and stayed bound while
// the sheet was shut.
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
      class="fixed inset-0 z-[60] bg-sand-900/30 backdrop-blur-[2px] lg:hidden"
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
      ref="sheetRef"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="headingId"
      tabindex="-1"
      class="fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overscroll-contain overflow-x-hidden overflow-y-auto rounded-t-2xl border border-sand-200 bg-white p-5 shadow-2xl focus:outline-none lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-full lg:max-h-none lg:w-96 lg:rounded-none lg:rounded-l-2xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h3 :id="headingId" class="font-display text-lg text-sand-900">
          {{ stage === "settings" ? "Trip settings" : "Delete days and activities?" }}
        </h3>
        <button
          type="button"
          class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 focus-ring"
          aria-label="Close"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>

      <!-- Settings stage -->
      <template v-if="stage === 'settings'">
        <!-- Trip info section -->
        <section class="mt-5">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-sand-500">Trip info</h4>
          <form class="mt-3 space-y-3" @submit.prevent="handleTripInfoSubmit">
            <div ref="countryFieldRef">
              <label class="block text-xs font-medium text-sand-500">Destination</label>
              <div class="mt-1">
                <CountryCombobox v-model="countryCode" placeholder="Pick a country" />
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-sand-500">Trip name</label>
              <input
                v-model="name"
                type="text"
                maxlength="100"
                placeholder="e.g. Honeymoon 2026 (optional)"
                class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-sand-500">Start date</label>
                <input
                  v-model="startDate"
                  type="date"
                  required
                  class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-sand-500">End date</label>
                <input
                  v-model="endDate"
                  type="date"
                  required
                  class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label
              class="flex items-start gap-3 rounded-xl border border-sand-200 bg-sand-50/50 px-3 py-2.5"
            >
              <input
                v-model="cancelled"
                type="checkbox"
                class="mt-0.5 h-4 w-4 rounded border-sand-300 text-terra-500 focus:ring-terra-300"
              />
              <span>
                <span class="block text-sm font-medium text-sand-800">Cancelled</span>
                <span class="block text-xs leading-5 text-sand-500">
                  Hide this trip from upcoming travel prompts.
                </span>
              </span>
            </label>

            <p v-if="tripInfoError" class="text-sm text-red-600">{{ tripInfoError }}</p>

            <div class="flex justify-end">
              <button
                type="submit"
                :disabled="savingTripInfo || !canSaveTripInfo"
                class="inline-flex min-h-11 items-center rounded-lg bg-cta px-3 text-xs font-medium text-white hover:bg-cta-hover disabled:opacity-50"
              >
                {{ savingTripInfo ? "Saving..." : "Save changes" }}
              </button>
            </div>
          </form>
        </section>

        <div class="my-5 border-t border-sand-200" />

        <!-- Preferences section -->
        <section>
          <h4 class="text-xs font-semibold uppercase tracking-wide text-sand-500">Preferences</h4>
          <p class="mt-1 text-xs text-sand-500">AI suggestions will respect these preferences.</p>

          <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label class="block text-xs font-medium text-sand-500">Budget</label>
              <select
                :value="trip.preferences?.budget || ''"
                class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
                @change="
                  emit('updatePreference', 'budget', ($event.target as HTMLSelectElement).value)
                "
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
                class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
                @change="
                  emit('updatePreference', 'pace', ($event.target as HTMLSelectElement).value)
                "
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
                class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm disabled:opacity-50"
                @change="emit('changeCurrency', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="c in currencies" :key="c.code" :value="c.code">
                  {{ c.label }}
                </option>
              </select>
            </div>

            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-sand-500">Travel time mode</label>
              <select
                :value="trip.preferences?.transportMode || 'driving'"
                class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
                @change="
                  emit(
                    'updatePreference',
                    'transportMode',
                    ($event.target as HTMLSelectElement).value,
                  )
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
                class="input-focus mt-1 block min-h-11 w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm"
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
        </section>
      </template>

      <!-- Destructive date-shrink confirm stage -->
      <template v-else>
        <p class="mt-2 text-sm text-sand-600">
          Shrinking the date range removes these days and their activities:
        </p>

        <ul class="mt-4 max-h-64 space-y-2 overflow-y-auto">
          <li
            v-for="d in daysToDelete"
            :key="d.id"
            class="rounded-lg border border-red-200 bg-red-50 p-3"
          >
            <p class="text-sm font-medium text-red-900">
              Day {{ d.dayNumber }} ({{ formatDate(d.date) }})
            </p>
            <p class="mt-1 text-xs text-red-700 break-words">
              {{ d.activityCount }}
              {{ d.activityCount === 1 ? "activity" : "activities" }}:
              {{ d.activityNames.join(", ") }}
            </p>
          </li>
        </ul>

        <p v-if="tripInfoError" class="mt-3 text-sm text-red-600">{{ tripInfoError }}</p>

        <div class="flex justify-end gap-3 pt-4">
          <button
            type="button"
            class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
            @click="stage = 'settings'"
          >
            Back
          </button>
          <button
            type="button"
            :disabled="savingTripInfo"
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            @click="commitTripInfo"
          >
            Delete and save
          </button>
        </div>
      </template>
    </div>
  </Transition>
</template>
