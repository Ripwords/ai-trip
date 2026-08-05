<script setup lang="ts">
import type { TripExpenseSummary } from "#shared/utils/expense-summary"

interface Activity {
  type: string
  costEstimate: string | null
  placeId?: string | null
}

interface Day {
  activities: Activity[]
}

const props = defineProps<{
  days: Day[]
  currencyCode?: string
  /**
   * The one server-computed cost picture (#38). This component used to show
   * `activities.costEstimate` under the label "Est. Cost" while the expenses
   * tab showed a completely different number under "Total".
   */
  summary: TripExpenseSummary | null
  tripId?: string
}>()

const emit = defineEmits<{
  refreshed: []
}>()

const totalActivities = computed(() =>
  props.days.reduce((sum, day) => sum + day.activities.length, 0),
)

const totalCost = computed(() => props.summary?.plannedTotal ?? 0)

// The two halves of the one server-computed total. `summary.total` is
// `expensesTotal + reservationsTotal` already (expense-summary.ts), so the
// "Spent" line shows the expense half and the "Bookings" line the reservation
// half — adding either to `summary.total` would count it twice.
const totalSpent = computed(() => props.summary?.expensesTotal ?? 0)
const totalBookings = computed(() => props.summary?.reservationsTotal ?? 0)

const totalDays = computed(() => props.days.length)

const typeBreakdown = computed(() => {
  const counts: Record<string, number> = {}
  for (const day of props.days) {
    for (const activity of day.activities) {
      counts[activity.type] = (counts[activity.type] || 0) + 1
    }
  }
  return counts
})

const budgetNum = computed(() => props.summary?.budget ?? null)

// Expenses were the only store the budget bar knew about, so a prepaid hotel
// booking never moved it. `summary.total` counts both (#61), and it is the ONE
// server-computed total (#38) — this component adds nothing to it. It briefly
// did, which rendered a €900 hotel as €1,800 committed and inflated the bar.
const totalCommitted = computed(() => props.summary?.total ?? 0)

// Same number every other budget bar on the trip shows (`TripOverview`,
// `ExpenseTracker`), for the same reason: there is one answer to "how much of
// the budget is gone", and it comes from the server.
const budgetPercent = computed(() => props.summary?.budgetPercent ?? 0)

const progressBarColor = computed(() => {
  if (budgetPercent.value >= 100) return "bg-terra-600"
  if (budgetPercent.value >= 80) return "bg-terra-400"
  return "bg-forest-500"
})

const typeBadgeClasses: Record<string, string> = {
  attraction: "bg-ocean-50 text-ocean-700",
  restaurant: "bg-terra-50 text-terra-700",
  hotel: "bg-ocean-50 text-ocean-700",
  transport: "bg-sand-100 text-sand-700",
  shopping: "bg-terra-50 text-terra-600",
  entertainment: "bg-forest-50 text-forest-700",
}

const { format: formatCurrencyRaw } = useCurrencyFormat(() => props.currencyCode)

function formatCurrency(amount: number): string {
  return formatCurrencyRaw(amount, { compact: true })
}

// "Refresh from Google Maps" — recomputes costEstimate for any activity
// on the trip that has a placeId but no cost yet, using Google's
// priceRange. Only relevant when there are activities with placeIds.
const refreshing = ref(false)
const refreshMessage = ref<string | null>(null)
const refreshError = ref(false)
const hasPlaceIdActivities = computed(() =>
  props.days.some((d) => d.activities.some((a) => !!a.placeId)),
)

async function refreshFromGoogle() {
  if (!props.tripId || refreshing.value) return
  refreshing.value = true
  refreshMessage.value = null
  refreshError.value = false
  try {
    const result = await $fetch<{ updated: number; candidates: number }>(
      `/api/trips/${props.tripId}/refresh-cost-estimates`,
      { method: "POST" },
    )
    refreshMessage.value =
      result.updated === 0
        ? result.candidates === 0
          ? "Nothing to refresh, costs are already set."
          : "Google doesn't have price data for any of these places."
        : `Updated ${result.updated} of ${result.candidates} from Google Maps.`
    emit("refreshed")
  } catch (e: unknown) {
    console.error("Failed to refresh cost estimates:", e)
    refreshError.value = true
    refreshMessage.value = "Couldn't refresh, try again in a moment."
  } finally {
    refreshing.value = false
    setTimeout(() => {
      refreshMessage.value = null
    }, 5000)
  }
}
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-6">
    <h3 class="text-sm font-semibold text-sand-900">Trip Summary</h3>

    <div class="mt-4 grid grid-cols-3 gap-4">
      <div class="text-center">
        <p class="text-2xl font-display text-sand-900">{{ totalDays }}</p>
        <p class="text-xs text-sand-500">Days</p>
      </div>
      <div class="text-center">
        <p class="text-2xl font-display text-sand-900">{{ totalActivities }}</p>
        <p class="text-xs text-sand-500">Activities</p>
      </div>
      <div class="text-center">
        <p class="text-2xl font-display text-sand-900">
          {{ formatCurrency(totalCost) }}
        </p>
        <p class="flex items-center justify-center gap-1 text-xs text-sand-500">
          Est. Cost
          <button
            v-if="tripId && hasPlaceIdActivities"
            type="button"
            :disabled="refreshing"
            title="Refresh cost estimates from Google Maps"
            aria-label="Refresh cost estimates from Google Maps"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-400 transition hover:text-terra-500 focus-ring disabled:opacity-50"
            @click="refreshFromGoogle"
          >
            <Icon
              :name="refreshing ? 'lucide:loader' : 'lucide:refresh-cw'"
              class="h-3 w-3"
              :class="{ 'animate-spin': refreshing }"
            />
          </button>
        </p>
      </div>
    </div>

    <p
      v-if="refreshMessage"
      class="mt-2 text-center text-[11px] text-sand-500"
      :role="refreshError ? 'alert' : 'status'"
      aria-live="polite"
    >
      {{ refreshMessage }}
    </p>

    <!-- Budget & Spend -->
    <div v-if="budgetNum || totalCommitted" class="mt-4 space-y-2 border-t border-sand-200 pt-4">
      <div v-if="budgetNum" class="flex items-center justify-between text-sm">
        <span class="text-sand-600">Budget</span>
        <span class="font-semibold text-sand-900">{{ formatCurrency(budgetNum) }}</span>
      </div>
      <div v-if="totalSpent > 0" class="flex items-center justify-between text-sm">
        <span class="text-sand-600">Spent</span>
        <span class="font-semibold text-sand-900">{{ formatCurrency(totalSpent) }}</span>
      </div>
      <div v-if="totalBookings > 0" class="flex items-center justify-between text-sm">
        <span class="text-sand-600">Bookings</span>
        <span class="font-semibold text-sand-900">{{ formatCurrency(totalBookings) }}</span>
      </div>
      <div v-if="budgetNum && totalCommitted" class="mt-1">
        <div class="h-1.5 w-full rounded-full bg-sand-200">
          <div
            class="h-1.5 rounded-full transition-all"
            :class="progressBarColor"
            :style="{ width: `${Math.min(budgetPercent, 100)}%` }"
          />
        </div>
      </div>
    </div>

    <div v-if="Object.keys(typeBreakdown).length" class="mt-4 flex flex-wrap gap-2">
      <span
        v-for="(count, type) in typeBreakdown"
        :key="type"
        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
        :class="typeBadgeClasses[type as string] || 'bg-sand-100 text-sand-700'"
      >
        {{ formatType(type as string) }}
        <span class="font-bold">{{ count }}</span>
      </span>
    </div>
  </div>
</template>
