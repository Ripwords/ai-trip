<script setup lang="ts">
interface TripActivity {
  id: string
  name: string
  type: string
  lat: number | null
  lng: number | null
  address: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  sortOrder: number
}

interface TripDay {
  id: string
  dayNumber: number
  date: string
  notes: string | null
  accommodationName: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
  activities: TripActivity[]
}

interface TripData {
  destination: string
  startDate: string
  endDate: string
  status: string
  budget: string | null
  currencyCode: string
  preferences: Record<string, unknown> | null
}

interface ExpenseRecord {
  id: string
  description: string
  amount: string
  category: string
  paidAt: string | null
}

interface DayForecast {
  date: string
  tempMax: number
  tempMin: number
  weatherCode: number
}

interface WeatherResponse {
  forecasts: DayForecast[]
  isHistorical: boolean
}

const props = defineProps<{
  trip: TripData
  sortedDays: TripDay[]
  expensesList: ExpenseRecord[]
  totalExpenses: number
  currencyCode: string
}>()

const emit = defineEmits<{
  "navigate-to-day": [dayId: string]
}>()

const expandedTypes = ref<Set<string>>(new Set())
const sidebarOpen = ref(true)
const selectedDayId = ref<string | null>(null)

function toggleDaySelection(dayId: string) {
  selectedDayId.value = selectedDayId.value === dayId ? null : dayId
}

// Representative coordinate for weather fetch
const representativeCoord = computed(() => {
  for (const day of props.sortedDays) {
    for (const a of day.activities) {
      if (a.lat != null && a.lng != null) return { lat: a.lat, lng: a.lng }
    }
    if (day.accommodationLat != null && day.accommodationLng != null) {
      return { lat: day.accommodationLat, lng: day.accommodationLng }
    }
  }
  return null
})

const weatherQuery = computed(() => {
  if (!representativeCoord.value) return undefined
  return {
    lat: representativeCoord.value.lat,
    lng: representativeCoord.value.lng,
    startDate: props.trip.startDate,
    endDate: props.trip.endDate,
  }
})

const { data: weatherData } = useFetch<WeatherResponse>("/api/weather", {
  query: weatherQuery,
  lazy: true,
  server: false,
  watch: [weatherQuery],
  immediate: true,
})

const weatherByDate = computed(() => {
  const map = new Map<string, DayForecast>()
  if (!weatherData.value?.forecasts) return map
  for (const f of weatherData.value.forecasts) {
    map.set(f.date, f)
  }
  return map
})

const isHistoricalWeather = computed(() => weatherData.value?.isHistorical ?? false)

// Accommodation grouping
interface AccommodationGroup {
  name: string
  address: string | null
  dayNumbers: number[]
}

const accommodationGroups = computed(() => {
  const groups: AccommodationGroup[] = []
  let current: AccommodationGroup | null = null
  for (const day of props.sortedDays) {
    if (!day.accommodationName) {
      current = null
      continue
    }
    if (current && current.name === day.accommodationName) {
      current.dayNumbers.push(day.dayNumber)
    } else {
      current = {
        name: day.accommodationName,
        address: day.accommodationAddress,
        dayNumbers: [day.dayNumber],
      }
      groups.push(current)
    }
  }
  return groups
})

// Activities grouped by type
const activitiesByType = computed(() => {
  const groups: Record<string, TripActivity[]> = {}
  for (const day of props.sortedDays) {
    for (const a of day.activities) {
      const type = a.type || "other"
      if (!groups[type]) groups[type] = []
      groups[type].push(a)
    }
  }
  return groups
})

const typeColors: Record<string, string> = {
  attraction: "bg-ocean-500",
  restaurant: "bg-terra-500",
  hotel: "bg-forest-500",
  transport: "bg-sand-500",
  shopping: "bg-terra-400",
  entertainment: "bg-ocean-400",
  museum: "bg-ocean-600",
  park: "bg-forest-400",
  cafe: "bg-terra-300",
  bar: "bg-terra-600",
  spa: "bg-ocean-300",
}

// Expenses by category
const expensesByCategory = computed(() => {
  const cats: Record<string, number> = {}
  for (const e of props.expensesList) {
    const cat = e.category || "other"
    cats[cat] = (cats[cat] ?? 0) + parseFloat(e.amount)
  }
  return Object.entries(cats).toSorted(([, a], [, b]) => b - a)
})

function toggleType(type: string) {
  if (expandedTypes.value.has(type)) {
    expandedTypes.value.delete(type)
  } else {
    expandedTypes.value.add(type)
  }
}

// "What's Next"
const isOngoing = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(props.trip.startDate + "T00:00:00")
  const end = new Date(props.trip.endDate + "T00:00:00")
  return start <= today && today <= end
})

interface UpcomingActivity {
  activity: TripActivity
  dayId: string
  dayNumber: number
}

const upcomingActivities = computed<UpcomingActivity[]>(() => {
  if (!isOngoing.value) return []
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  const results: UpcomingActivity[] = []
  for (const day of props.sortedDays) {
    if (day.date < todayStr) continue
    for (const activity of day.activities) {
      if (day.date === todayStr) {
        if (!activity.suggestedTime || activity.suggestedTime <= currentTime) continue
      }
      results.push({ activity, dayId: day.id, dayNumber: day.dayNumber })
      if (results.length >= 4) return results
    }
  }
  return results
})

// Stats
const totalActivities = computed(() =>
  props.sortedDays.reduce((sum, d) => sum + d.activities.length, 0),
)

const totalEstCost = computed(() => {
  let sum = 0
  for (const d of props.sortedDays) {
    for (const a of d.activities) {
      if (a.costEstimate) sum += parseFloat(a.costEstimate)
    }
  }
  return sum
})

const budgetNum = computed(() => (props.trip.budget ? parseFloat(props.trip.budget) : null))
const budgetPercent = computed(() => {
  if (!budgetNum.value || budgetNum.value === 0 || !props.totalExpenses) return 0
  return Math.min((props.totalExpenses / budgetNum.value) * 100, 100)
})

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: props.currencyCode || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDayRange(dayNumbers: number[]): string {
  if (dayNumbers.length === 1) return `Day ${dayNumbers[0]}`
  return `Days ${dayNumbers[0]}–${dayNumbers[dayNumbers.length - 1]}`
}
</script>

<template>
  <div class="relative">
    <!-- Mobile: stacked map -->
    <div class="h-[65vh] overflow-hidden rounded-2xl shadow-lg lg:hidden">
      <ClientOnly>
        <TripOverviewMap :days="sortedDays" :selected-day-id="selectedDayId" />
      </ClientOnly>
    </div>

    <!-- Desktop: map + sidebar in a clipped container -->
    <div
      class="hidden lg:relative lg:mx-auto lg:block lg:h-[calc(100vh-220px)] lg:overflow-hidden lg:rounded-2xl lg:shadow-lg"
    >
      <!-- Map fills entire container -->
      <div class="absolute inset-0">
        <ClientOnly>
          <TripOverviewMap :days="sortedDays" :selected-day-id="selectedDayId" />
        </ClientOnly>
      </div>

      <!-- Sidebar toggle -->
      <button
        class="ov-toggle absolute top-3 z-30 flex items-center justify-center rounded-xl shadow-lg transition-all duration-300 hover:scale-105"
        :class="sidebarOpen ? 'left-[356px]' : 'left-3'"
        @click="sidebarOpen = !sidebarOpen"
      >
        <Icon
          :name="sidebarOpen ? 'lucide:panel-left-close' : 'lucide:panel-left-open'"
          class="h-4 w-4"
        />
      </button>

      <!-- Sidebar panel -->
      <div
        class="ov-sidebar-scroll absolute inset-y-0 left-0 z-20 w-[350px] overflow-y-auto p-2 transition-transform duration-300 ease-out"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
      >
        <div class="space-y-2.5">
          <!-- Hero stats card -->
          <div class="ov-card ov-card-hero p-5">
            <div class="grid grid-cols-3 gap-3 text-center">
              <div>
                <p class="text-2xl font-display leading-none">{{ sortedDays.length }}</p>
                <p class="mt-1 text-[11px] uppercase tracking-wider opacity-60">Days</p>
              </div>
              <div>
                <p class="text-2xl font-display leading-none">{{ totalActivities }}</p>
                <p class="mt-1 text-[11px] uppercase tracking-wider opacity-60">Activities</p>
              </div>
              <div>
                <p class="text-2xl font-display leading-none">{{ formatCurrency(totalEstCost) }}</p>
                <p class="mt-1 text-[11px] uppercase tracking-wider opacity-60">Est. Cost</p>
              </div>
            </div>
            <div v-if="budgetNum" class="mt-4">
              <div class="flex items-center justify-between text-[11px] opacity-70">
                <span>{{ formatCurrency(totalExpenses) }} spent</span>
                <span>{{ formatCurrency(budgetNum) }} budget</span>
              </div>
              <div class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="budgetPercent >= 90 ? 'bg-terra-400' : 'bg-white/70'"
                  :style="{ width: `${budgetPercent}%` }"
                />
              </div>
            </div>
          </div>

          <!-- What's Next -->
          <div v-if="upcomingActivities.length > 0" class="ov-card p-4">
            <h3
              class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-terra-500"
            >
              <Icon name="lucide:zap" class="h-3 w-3" />
              Up Next
            </h3>
            <div class="mt-2.5 space-y-1">
              <button
                v-for="item in upcomingActivities"
                :key="item.activity.id"
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-sand-50"
                @click="emit('navigate-to-day', item.dayId)"
              >
                <span
                  v-if="item.activity.suggestedTime"
                  class="shrink-0 text-xs font-semibold tabular-nums text-terra-500"
                >
                  {{ formatTime12h(item.activity.suggestedTime) }}
                </span>
                <span class="min-w-0 truncate text-sm text-sand-800">{{ item.activity.name }}</span>
                <span class="ml-auto shrink-0 text-[11px] text-sand-400"
                  >D{{ item.dayNumber }}</span
                >
              </button>
            </div>
          </div>

          <!-- Day Timeline -->
          <div class="ov-card p-3">
            <div class="flex items-center justify-between px-1 pb-2">
              <h3 class="ov-section-title text-[11px] font-semibold uppercase tracking-widest">
                Itinerary
              </h3>
              <span v-if="isHistoricalWeather" class="text-[11px] italic text-sand-300">
                ~last year
              </span>
            </div>
            <div class="space-y-px">
              <button
                v-for="day in sortedDays"
                :key="day.id"
                class="ov-day-row group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition"
                :class="{ 'ov-day-row-active': selectedDayId === day.id }"
                @click="toggleDaySelection(day.id)"
              >
                <span
                  class="ov-day-num flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition"
                  :class="{ 'ov-day-num-active': selectedDayId === day.id }"
                >
                  {{ day.dayNumber }}
                </span>
                <div class="min-w-0 flex-1">
                  <span class="ov-day-date text-[13px] font-medium"
                    ><NuxtTime
                      :datetime="day.date + 'T00:00:00'"
                      locale="en-US"
                      weekday="short"
                      month="short"
                      day="numeric"
                  /></span>
                  <span v-if="day.activities.length > 0" class="day-meta ml-1.5 text-[11px]">
                    {{ day.activities.length }} {{ day.activities.length === 1 ? "spot" : "spots" }}
                  </span>
                  <div
                    v-if="day.accommodationName"
                    class="day-sub truncate text-[11px] max-w-[160px]"
                  >
                    {{ day.accommodationName }}
                  </div>
                  <div v-else-if="!day.activities.length" class="day-sub text-[11px] italic">
                    Nothing planned
                  </div>
                </div>
                <div
                  v-if="weatherByDate.get(day.date)"
                  class="ov-day-weather flex shrink-0 items-center gap-1"
                >
                  <Icon
                    :name="getWeatherInfo(weatherByDate.get(day.date)!.weatherCode).icon"
                    class="h-3.5 w-3.5"
                  />
                  <span class="text-[11px] tabular-nums"
                    >{{ weatherByDate.get(day.date)!.tempMax }}°</span
                  >
                </div>
              </button>
            </div>
          </div>

          <!-- Accommodations -->
          <div v-if="accommodationGroups.length > 0" class="ov-card p-4">
            <h3 class="ov-section-title text-xs font-semibold uppercase tracking-wider">Stays</h3>
            <div class="mt-2.5 space-y-1.5">
              <div
                v-for="group in accommodationGroups"
                :key="group.name + group.dayNumbers[0]"
                class="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
              >
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-forest-50 text-forest-600"
                >
                  <Icon name="lucide:bed-double" class="h-3.5 w-3.5" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-sand-800 truncate">{{ group.name }}</p>
                  <p class="text-[11px] text-sand-400">{{ formatDayRange(group.dayNumbers) }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Activities by Type -->
          <div v-if="Object.keys(activitiesByType).length > 0" class="ov-card p-4">
            <h3 class="ov-section-title text-xs font-semibold uppercase tracking-wider">Places</h3>
            <div class="mt-2.5 space-y-0.5">
              <div v-for="(activities, type) in activitiesByType" :key="type">
                <button
                  class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-sand-50"
                  @click="toggleType(type as string)"
                >
                  <span
                    class="h-2 w-2 shrink-0 rounded-full"
                    :class="typeColors[type as string] || 'bg-sand-400'"
                  />
                  <span class="flex-1 text-sm text-sand-700">{{ formatType(type as string) }}</span>
                  <span class="text-xs tabular-nums text-sand-400">{{ activities.length }}</span>
                  <Icon
                    name="lucide:chevron-down"
                    class="h-3 w-3 text-sand-300 transition-transform"
                    :class="{ '-rotate-180': expandedTypes.has(type as string) }"
                  />
                </button>
                <div
                  v-if="expandedTypes.has(type as string)"
                  class="ml-5 border-l border-sand-100 pl-3 pb-1"
                >
                  <div
                    v-for="activity in activities"
                    :key="activity.id"
                    class="flex items-center justify-between py-1.5"
                  >
                    <span class="text-xs text-sand-600 truncate">{{ activity.name }}</span>
                    <span
                      v-if="activity.costEstimate"
                      class="shrink-0 text-[11px] tabular-nums text-sand-400"
                    >
                      {{ formatCurrency(parseFloat(activity.costEstimate)) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Expenses -->
          <div v-if="expensesByCategory.length > 0" class="ov-card p-4">
            <h3 class="ov-section-title text-xs font-semibold uppercase tracking-wider">
              Spending
            </h3>
            <div class="mt-2.5 space-y-2">
              <div
                v-for="[category, amount] in expensesByCategory"
                :key="category"
                class="flex items-center justify-between"
              >
                <span class="text-xs text-sand-600">{{ formatType(category) }}</span>
                <span class="text-xs font-semibold tabular-nums text-sand-800">{{
                  formatCurrency(amount)
                }}</span>
              </div>
              <div class="flex items-center justify-between border-t border-sand-100 pt-2">
                <span class="text-xs font-semibold text-sand-700">Total</span>
                <span class="text-sm font-display text-sand-900">{{
                  formatCurrency(totalExpenses)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile: sidebar content stacked below map -->
    <div class="mt-5 space-y-3 lg:hidden">
      <!-- Day Timeline first on mobile -->
      <div class="ov-card p-3">
        <div class="flex items-center justify-between px-1 pb-2">
          <h3 class="ov-section-title text-[11px] font-semibold uppercase tracking-widest">
            Itinerary
          </h3>
          <span
            v-if="selectedDayId"
            class="text-[11px] text-terra-500 cursor-pointer"
            @click="selectedDayId = null"
            >Clear</span
          >
        </div>
        <div class="space-y-px">
          <button
            v-for="day in sortedDays"
            :key="day.id"
            class="ov-day-row group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition"
            :class="{ 'ov-day-row-active': selectedDayId === day.id }"
            @click="toggleDaySelection(day.id)"
          >
            <span
              class="ov-day-num flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition"
              :class="{ 'ov-day-num-active': selectedDayId === day.id }"
            >
              {{ day.dayNumber }}
            </span>
            <div class="min-w-0 flex-1">
              <span class="ov-day-date text-[13px] font-medium"
                ><NuxtTime
                  :datetime="day.date + 'T00:00:00'"
                  locale="en-US"
                  weekday="short"
                  month="short"
                  day="numeric"
              /></span>
              <span v-if="day.activities.length > 0" class="day-meta ml-1.5 text-[11px]">
                {{ day.activities.length }} {{ day.activities.length === 1 ? "spot" : "spots" }}
              </span>
              <div v-if="day.accommodationName" class="day-sub truncate text-[11px]">
                {{ day.accommodationName }}
              </div>
              <div v-else-if="!day.activities.length" class="day-sub text-[11px] italic">
                Nothing planned
              </div>
            </div>
            <div
              v-if="weatherByDate.get(day.date)"
              class="ov-day-weather flex shrink-0 items-center gap-1"
            >
              <Icon
                :name="getWeatherInfo(weatherByDate.get(day.date)!.weatherCode).icon"
                class="h-3.5 w-3.5"
              />
              <span class="text-[11px] tabular-nums"
                >{{ weatherByDate.get(day.date)!.tempMax }}°</span
              >
            </div>
          </button>
        </div>
      </div>

      <!-- Accommodations -->
      <div v-if="accommodationGroups.length > 0" class="ov-card p-4">
        <h3 class="ov-section-title text-xs font-semibold uppercase tracking-wider">Stays</h3>
        <div class="mt-2.5 space-y-1.5">
          <div
            v-for="group in accommodationGroups"
            :key="group.name + group.dayNumbers[0]"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
          >
            <span
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-forest-50 text-forest-600"
            >
              <Icon name="lucide:bed-double" class="h-3.5 w-3.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-sand-800 truncate">{{ group.name }}</p>
              <p class="text-[11px] text-sand-400">{{ formatDayRange(group.dayNumbers) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Trip Summary -->
      <TripStats
        :days="sortedDays"
        :budget="trip.budget"
        :currency-code="currencyCode"
        :total-expenses="totalExpenses"
      />
    </div>
  </div>
</template>

<style>
/* Use unscoped styles with unique class names to avoid Vue scoped specificity issues */

/* Scrollbar */
.ov-sidebar-scroll {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
.ov-sidebar-scroll::-webkit-scrollbar {
  display: none !important;
}

/* ── Light mode (base) ──────────────────────── */
.ov-card {
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #ffffff;
}

.ov-card-hero {
  background: linear-gradient(135deg, #2a2520, #3d3328) !important;
  color: #faf8f5;
  border: none;
}

.ov-toggle {
  width: 34px;
  height: 34px;
  background: #ffffff;
  color: #6e5c46;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.ov-toggle:hover {
  color: #e85d3a;
}

/* Day rows — light */
.ov-day-num {
  background: #f3efe8;
  color: #6e5c46;
}
.ov-day-row:hover .ov-day-num {
  background: #e85d3a;
  color: #fff;
}
.ov-day-date {
  color: #3d3328;
}
.ov-day-meta {
  color: #9f8b6f;
}
.ov-day-sub {
  color: #b8a78f;
}
.ov-day-weather {
  color: #9f8b6f;
}
.ov-day-row:hover {
  background: rgba(232, 93, 58, 0.06);
}
.ov-day-row-active {
  background: rgba(232, 93, 58, 0.1);
}
.ov-day-num-active {
  background: #e85d3a !important;
  color: #fff !important;
}
.ov-section-title {
  color: #9f8b6f;
}

/* ── Light mode — desktop glass ─────────────── */
@media (min-width: 1024px) {
  .ov-card {
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border-color: rgba(255, 255, 255, 0.5);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }
  .ov-card-hero {
    background: linear-gradient(135deg, rgba(42, 37, 32, 0.92), rgba(61, 51, 40, 0.88));
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
  }
  .ov-toggle {
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}

/* ── Dark mode ──────────────────────────────── */
.dark .ov-card {
  background: #1e1b18;
  border-color: rgba(255, 255, 255, 0.06);
}
.dark .ov-card-hero,
.dark .ov-card.ov-card-hero {
  background: linear-gradient(135deg, #1a1714, #23201b) !important;
  color: #f3efe8;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.dark .ov-toggle {
  background: #1e1b18;
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
}
.dark .ov-toggle:hover {
  color: #e85d3a;
}

/* Day rows — dark */
.dark .ov-day-num {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}
.dark .ov-day-row:hover .ov-day-num {
  background: #e85d3a;
  color: #fff;
}
.dark .ov-day-date {
  color: rgba(255, 255, 255, 0.85);
}
.dark .ov-day-meta {
  color: rgba(255, 255, 255, 0.4);
}
.dark .ov-day-sub {
  color: rgba(255, 255, 255, 0.3);
}
.dark .ov-day-weather {
  color: rgba(255, 255, 255, 0.4);
}
.dark .ov-day-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.dark .ov-day-row-active {
  background: rgba(232, 93, 58, 0.12);
}
.dark .ov-day-num-active {
  background: #e85d3a !important;
  color: #fff !important;
}
.dark .ov-section-title {
  color: rgba(255, 255, 255, 0.35);
}

/* ── Dark mode — desktop glass ──────────────── */
@media (min-width: 1024px) {
  .dark .ov-card {
    background: rgba(26, 23, 20, 0.82);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border-color: rgba(255, 255, 255, 0.05);
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
  }
  .dark .ov-card-hero,
  .dark .ov-card.ov-card-hero {
    background: linear-gradient(135deg, rgba(26, 23, 20, 0.92), rgba(35, 32, 27, 0.88)) !important;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.25);
  }
  .dark .ov-toggle {
    background: rgba(26, 23, 20, 0.82);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}
</style>
