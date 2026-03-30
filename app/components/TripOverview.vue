<script setup lang="ts">
interface TripActivity {
  id: string;
  name: string;
  type: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  suggestedTime: string | null;
  estimatedDurationMinutes: number | null;
  costEstimate: string | null;
  sortOrder: number;
}

interface TripDay {
  id: string;
  dayNumber: number;
  date: string;
  notes: string | null;
  accommodationName: string | null;
  accommodationAddress: string | null;
  accommodationLat: number | null;
  accommodationLng: number | null;
  activities: TripActivity[];
}

interface TripData {
  destination: string;
  startDate: string;
  endDate: string;
  status: string;
  budget: string | null;
  currencyCode: string;
  preferences: Record<string, unknown> | null;
}

interface ExpenseRecord {
  id: string;
  description: string;
  amount: string;
  category: string;
  paidAt: string | null;
}

interface DayForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
}

interface WeatherResponse {
  forecasts: DayForecast[];
  isHistorical: boolean;
}

const props = defineProps<{
  trip: TripData;
  sortedDays: TripDay[];
  expensesList: ExpenseRecord[];
  totalExpenses: number;
  currencyCode: string;
}>();

const emit = defineEmits<{
  "navigate-to-day": [dayId: string];
}>();

const expandedTypes = ref<Set<string>>(new Set());

// Representative coordinate for weather fetch
const representativeCoord = computed(() => {
  for (const day of props.sortedDays) {
    for (const a of day.activities) {
      if (a.lat != null && a.lng != null) return { lat: a.lat, lng: a.lng };
    }
    if (day.accommodationLat != null && day.accommodationLng != null) {
      return { lat: day.accommodationLat, lng: day.accommodationLng };
    }
  }
  return null;
});

const weatherQuery = computed(() => {
  if (!representativeCoord.value) return undefined;
  return {
    lat: representativeCoord.value.lat,
    lng: representativeCoord.value.lng,
    startDate: props.trip.startDate,
    endDate: props.trip.endDate,
  };
});

const { data: weatherData } = useFetch<WeatherResponse>("/api/weather", {
  query: weatherQuery,
  lazy: true,
  server: false,
  watch: [weatherQuery],
  immediate: true,
});

const weatherByDate = computed(() => {
  const map = new Map<string, DayForecast>();
  if (!weatherData.value?.forecasts) return map;
  for (const f of weatherData.value.forecasts) {
    map.set(f.date, f);
  }
  return map;
});

const isHistoricalWeather = computed(() => weatherData.value?.isHistorical ?? false);

// Accommodation grouping: merge consecutive days with same accommodation
interface AccommodationGroup {
  name: string;
  address: string | null;
  dayNumbers: number[];
}

const accommodationGroups = computed(() => {
  const groups: AccommodationGroup[] = [];
  let current: AccommodationGroup | null = null;

  for (const day of props.sortedDays) {
    if (!day.accommodationName) {
      current = null;
      continue;
    }
    if (current && current.name === day.accommodationName) {
      current.dayNumbers.push(day.dayNumber);
    } else {
      current = {
        name: day.accommodationName,
        address: day.accommodationAddress,
        dayNumbers: [day.dayNumber],
      };
      groups.push(current);
    }
  }
  return groups;
});

// Activities grouped by type
const activitiesByType = computed(() => {
  const groups: Record<string, TripActivity[]> = {};
  for (const day of props.sortedDays) {
    for (const a of day.activities) {
      const type = a.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(a);
    }
  }
  return groups;
});

const typeBadgeClasses: Record<string, string> = {
  attraction: "bg-ocean-50 text-ocean-700",
  restaurant: "bg-terra-50 text-terra-700",
  hotel: "bg-ocean-50 text-ocean-700",
  transport: "bg-sand-200 text-sand-700",
  shopping: "bg-terra-50 text-terra-600",
  entertainment: "bg-forest-50 text-forest-700",
  museum: "bg-ocean-50 text-ocean-600",
  park: "bg-forest-50 text-forest-700",
  cafe: "bg-terra-50 text-terra-600",
  bar: "bg-terra-50 text-terra-700",
  spa: "bg-ocean-50 text-ocean-600",
};

// Expenses by category
const expensesByCategory = computed(() => {
  const cats: Record<string, number> = {};
  for (const e of props.expensesList) {
    const cat = e.category || "other";
    cats[cat] = (cats[cat] ?? 0) + parseFloat(e.amount);
  }
  return Object.entries(cats).sort(([, a], [, b]) => b - a);
});

function toggleType(type: string) {
  if (expandedTypes.value.has(type)) {
    expandedTypes.value.delete(type);
  } else {
    expandedTypes.value.add(type);
  }
}

// "What's Next" — upcoming activities for ongoing trips
const isOngoing = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(props.trip.startDate + "T00:00:00");
  const end = new Date(props.trip.endDate + "T00:00:00");
  return start <= today && today <= end;
});

interface UpcomingActivity {
  activity: TripActivity;
  dayId: string;
  dayNumber: number;
}

const upcomingActivities = computed<UpcomingActivity[]>(() => {
  if (!isOngoing.value) return [];

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const results: UpcomingActivity[] = [];

  for (const day of props.sortedDays) {
    if (day.date < todayStr) continue;

    for (const activity of day.activities) {
      // For today: only future activities; for future days: all activities
      if (day.date === todayStr) {
        if (!activity.suggestedTime || activity.suggestedTime <= currentTime) continue;
      }
      results.push({ activity, dayId: day.id, dayNumber: day.dayNumber });
      if (results.length >= 4) return results;
    }
  }

  return results;
});

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: props.currencyCode || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDayRange(dayNumbers: number[]): string {
  if (dayNumbers.length === 1) return `Day ${dayNumbers[0]}`;
  return `Days ${dayNumbers[0]}–${dayNumbers[dayNumbers.length - 1]}`;
}
</script>

<template>
  <div class="flex flex-col gap-6 lg:flex-row">
    <!-- Left sidebar: Summary content -->
    <div class="flex-1 space-y-5 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto lg:pr-4 scrollbar-thin">
      <!-- Key Stats -->
      <TripStats
        :days="sortedDays"
        :budget="trip.budget"
        :currency-code="currencyCode"
        :total-expenses="totalExpenses"
      />

      <!-- What's Next (ongoing trips only) -->
      <div v-if="upcomingActivities.length > 0" class="rounded-2xl border border-terra-200 bg-terra-50/30 p-5">
        <h3 class="flex items-center gap-1.5 text-sm font-semibold text-terra-700">
          <Icon name="lucide:zap" class="h-3.5 w-3.5" />
          What's Next
        </h3>
        <div class="mt-3 space-y-2">
          <button
            v-for="item in upcomingActivities"
            :key="item.activity.id"
            class="flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-left transition hover:bg-sand-50"
            @click="emit('navigate-to-day', item.dayId)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                v-if="item.activity.suggestedTime"
                class="shrink-0 rounded-full bg-terra-100 px-2 py-0.5 text-[10px] font-bold text-terra-600"
              >
                {{ formatTime12h(item.activity.suggestedTime) }}
              </span>
              <span class="text-sm text-sand-800 truncate">{{ item.activity.name }}</span>
            </div>
            <span class="shrink-0 text-[10px] text-sand-400">Day {{ item.dayNumber }}</span>
          </button>
        </div>
      </div>

      <!-- Day Timeline -->
      <div class="rounded-2xl border border-sand-200 bg-white p-5">
        <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-sand-900">Day Timeline</h3>
        <span v-if="isHistoricalWeather" class="rounded-full bg-sand-100 px-2 py-0.5 text-[10px] text-sand-500">
          Weather based on last year
        </span>
      </div>
        <div class="mt-3 flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin lg:flex-col lg:overflow-x-visible lg:overflow-y-visible">
          <button
            v-for="day in sortedDays"
            :key="day.id"
            class="flex shrink-0 flex-col items-start rounded-xl border border-sand-200 p-3 text-left transition hover:border-terra-300 hover:bg-terra-50/30 lg:w-full lg:flex-row lg:items-center lg:justify-between lg:gap-3"
            style="min-width: 140px"
            @click="emit('navigate-to-day', day.id)"
          >
            <div class="flex items-center gap-2 lg:min-w-0">
              <span class="text-xs font-bold text-terra-500">Day {{ day.dayNumber }}</span>
              <span class="text-xs text-sand-500 hidden lg:inline">{{ formatDayDate(day.date) }}</span>
            </div>
            <span class="mt-0.5 text-xs text-sand-500 lg:hidden">{{ formatDayDate(day.date) }}</span>

            <!-- Weather + accommodation + count row -->
            <div class="mt-1.5 flex items-center gap-2 lg:mt-0 lg:shrink-0">
              <div
                v-if="weatherByDate.get(day.date)"
                class="flex items-center gap-0.5 text-xs text-sand-500"
              >
                <Icon :name="getWeatherInfo(weatherByDate.get(day.date)!.weatherCode).icon" class="h-3.5 w-3.5" />
                <span>{{ weatherByDate.get(day.date)!.tempMin }}°/{{ weatherByDate.get(day.date)!.tempMax }}°</span>
              </div>
              <div
                v-if="day.accommodationName"
                class="flex items-center gap-0.5 text-[10px] text-sand-400 max-w-[100px] lg:max-w-[120px]"
              >
                <Icon name="lucide:bed-double" class="h-3 w-3 shrink-0" />
                <span class="truncate">{{ day.accommodationName }}</span>
              </div>
              <span
                v-if="day.activities.length > 0"
                class="flex h-5 w-5 items-center justify-center rounded-full bg-terra-100 text-[10px] font-bold text-terra-600"
              >
                {{ day.activities.length }}
              </span>
              <span v-else class="text-[10px] italic text-sand-300">Empty</span>
            </div>
          </button>
        </div>
      </div>

      <!-- Accommodations -->
      <div v-if="accommodationGroups.length > 0" class="rounded-2xl border border-sand-200 bg-white p-5">
        <h3 class="text-sm font-semibold text-sand-900">Accommodations</h3>
        <div class="mt-3 space-y-2">
          <div
            v-for="group in accommodationGroups"
            :key="group.name + group.dayNumbers[0]"
            class="flex items-center justify-between rounded-xl border border-sand-200 px-3 py-2"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Icon name="lucide:bed-double" class="h-4 w-4 shrink-0 text-sand-500" />
              <div class="min-w-0">
                <p class="text-sm font-medium text-sand-900 truncate">{{ group.name }}</p>
                <p v-if="group.address" class="text-xs text-sand-400 truncate">{{ group.address }}</p>
              </div>
            </div>
            <span class="shrink-0 rounded-full bg-sand-100 px-2.5 py-0.5 text-xs font-medium text-sand-600">
              {{ formatDayRange(group.dayNumbers) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Activities by Type -->
      <div v-if="Object.keys(activitiesByType).length > 0" class="rounded-2xl border border-sand-200 bg-white p-5">
        <h3 class="text-sm font-semibold text-sand-900">Activities by Type</h3>
        <div class="mt-3 space-y-2">
          <div
            v-for="(activities, type) in activitiesByType"
            :key="type"
            class="rounded-xl border border-sand-200"
          >
            <button
              class="flex w-full items-center justify-between px-3 py-2 text-left"
              @click="toggleType(type as string)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="typeBadgeClasses[type as string] || 'bg-sand-100 text-sand-700'"
                >
                  {{ formatType(type as string) }}
                </span>
                <span class="text-xs text-sand-400">{{ activities.length }}</span>
              </div>
              <Icon
                name="lucide:chevron-right"
                class="h-3.5 w-3.5 text-sand-400 transition-transform"
                :class="{ 'rotate-90': expandedTypes.has(type as string) }"
              />
            </button>

            <div v-if="expandedTypes.has(type as string)" class="border-t border-sand-200 px-3 py-2">
              <div
                v-for="activity in activities"
                :key="activity.id"
                class="flex items-center justify-between py-1"
              >
                <div class="min-w-0">
                  <p class="text-sm text-sand-700 truncate">{{ activity.name }}</p>
                  <p v-if="activity.address" class="text-xs text-sand-400 truncate">{{ activity.address }}</p>
                </div>
                <span v-if="activity.costEstimate" class="shrink-0 text-xs font-medium text-sand-500">
                  {{ formatCurrency(parseFloat(activity.costEstimate)) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Budget Overview -->
      <div v-if="expensesByCategory.length > 0" class="rounded-2xl border border-sand-200 bg-white p-5">
        <h3 class="text-sm font-semibold text-sand-900">Expense Breakdown</h3>
        <div class="mt-3 space-y-2">
          <div
            v-for="[category, amount] in expensesByCategory"
            :key="category"
            class="flex items-center justify-between text-sm"
          >
            <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-sand-100 text-sand-700">
              {{ formatType(category) }}
            </span>
            <span class="font-semibold text-sand-900">{{ formatCurrency(amount) }}</span>
          </div>
          <div class="flex items-center justify-between border-t border-sand-200 pt-2 text-sm">
            <span class="font-semibold text-sand-900">Total</span>
            <span class="font-bold text-sand-900">{{ formatCurrency(totalExpenses) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Right side: Map (primary) -->
    <div class="order-first lg:order-none lg:w-[480px] lg:shrink-0">
      <div class="h-[250px] overflow-hidden rounded-2xl border border-sand-200 shadow-lg sm:h-[300px] lg:sticky lg:top-8 lg:h-[calc(100vh-320px)]">
        <ClientOnly>
          <TripOverviewMap :days="sortedDays" />
        </ClientOnly>
      </div>
    </div>
  </div>
</template>
