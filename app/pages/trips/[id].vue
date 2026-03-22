<script setup lang="ts">
definePageMeta({ layout: "app" });

const route = useRoute();
const tripId = route.params.id as string;

const {
  data: trip,
  status,
  refresh,
} = await useFetch(`/api/trips/${tripId}`);

useHead({
  title: computed(() =>
    trip.value ? `${trip.value.destination} — AI Trip` : "Trip — AI Trip"
  ),
});

const { data: ideas, refresh: refreshIdeas } = await useFetch<
  {
    id: string;
    name: string;
    type: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    placeId: string | null;
  }[]
>(`/api/trips/${tripId}/ideas`);

const { data: expensesList, refresh: refreshExpenses } = await useFetch<
  {
    id: string;
    description: string;
    amount: string;
    category: string;
    paidAt: string | null;
  }[]
>(`/api/trips/${tripId}/expenses`);

const aiLoading = ref(false);
const aiLoadingMode = ref<"generate" | "optimize">("generate");
const editingActivity = ref<(typeof allActivities.value)[number] | null>(null);
const editModalOpen = ref(false);
const highlightedActivityId = ref<string | null>(null);
const tripMapRef = ref<InstanceType<typeof TripMap> | null>(null);
const storageKeyTab = `trip-${tripId}-tab`;
const storageKeyDay = `trip-${tripId}-day`;

const activeTab = ref<"itinerary" | "notes" | "expenses">("itinerary");
const activeDayId = ref<string | null>(null);
const showPrefsEditor = ref(false);

function handleExportKml() {
  if (!trip.value) return;
  downloadKml(trip.value.destination, sortedDays.value.map((d) => ({
    dayNumber: d.dayNumber,
    date: d.date,
    activities: d.activities,
  })));
}

async function updatePreference(key: string, value: string) {
  if (!trip.value) return;
  const currentPrefs = trip.value.preferences ?? {};
  const updatedPrefs = { ...currentPrefs, [key]: value || undefined };
  try {
    await $fetch(`/api/trips/${tripId}`, {
      method: "PUT",
      body: { preferences: updatedPrefs },
    });
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to update preferences:", e);
  }
}
let sessionRestored = false;

if (import.meta.client) {
  watch(activeTab, (val) => sessionStorage.setItem(storageKeyTab, val));
  watch(activeDayId, (val) => { if (sessionRestored) sessionStorage.setItem(storageKeyDay, val ?? ""); });
}
const addActivityModal = ref<{
  open: boolean;
  dayId: string;
  dayNumber: number;
}>({ open: false, dayId: "", dayNumber: 1 });

const TripMap = resolveComponent("TripMap");

const allActivities = computed(() => {
  if (!trip.value?.days) return [];
  return trip.value.days
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .flatMap((day) => day.activities);
});

const hasActivities = computed(() =>
  sortedDays.value.some((d) => d.activities.length > 0)
);

const sortedDays = computed(() => {
  if (!trip.value?.days) return [];
  return [...trip.value.days].sort((a, b) => a.dayNumber - b.dayNumber);
});

const activeDay = computed(() =>
  sortedDays.value.find((d) => d.id === activeDayId.value) ?? null
);

const activeDayActivities = computed(() => activeDay.value?.activities ?? []);

const totalExpenses = computed(() => {
  if (!expensesList.value) return 0;
  return expensesList.value.reduce(
    (sum, e) => sum + parseFloat(e.amount),
    0
  );
});

// Set activeDayId: restore from sessionStorage on client, otherwise default to first day
watch(
  sortedDays,
  (days) => {
    if (days.length === 0) return;

    // On first client-side run, try to restore from sessionStorage
    if (import.meta.client && !sessionRestored) {
      sessionRestored = true;
      const storedTab = sessionStorage.getItem(storageKeyTab);
      if (storedTab === "itinerary" || storedTab === "notes" || storedTab === "expenses") {
        activeTab.value = storedTab;
      }
      const storedDay = sessionStorage.getItem(storageKeyDay);
      if (storedDay && days.some((d) => d.id === storedDay)) {
        activeDayId.value = storedDay;
        return;
      }
    }

    // If current day is valid, keep it
    if (activeDayId.value && days.some((d) => d.id === activeDayId.value)) return;

    // Default to first day
    activeDayId.value = days[0].id;
  },
  { immediate: true }
);

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  return `${s.toLocaleDateString("en-US", opts)} - ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

function formatDayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const aiError = ref("");
const aiMessage = ref("");
const aiPrompt = ref("");

async function handleAiSubmit() {
  if (!activeDayId.value || !aiPrompt.value.trim()) return;
  const prompt = aiPrompt.value.trim();
  aiPrompt.value = "";
  aiError.value = "";
  aiMessage.value = "";
  aiLoading.value = true;

  // Guess loading mode for the overlay
  const optimizeKeywords = /\b(optimize|reorder|rearrange|best route|efficient)\b/i;
  aiLoadingMode.value = optimizeKeywords.test(prompt) ? "optimize" : "generate";

  try {
    const result = await $fetch(`/api/trips/${tripId}/days/${activeDayId.value}/ai`, {
      method: "POST",
      body: { prompt },
    });
    aiMessage.value = result.message;
    await refresh();
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } };
    aiError.value = err.data?.message ?? "Something went wrong";
  } finally {
    aiLoading.value = false;
  }
}

const activeDayHasActivities = computed(
  () => (activeDay.value?.activities.length ?? 0) > 0
);

function handleEditActivity(activity: (typeof allActivities.value)[number]) {
  editingActivity.value = activity;
  editModalOpen.value = true;
}

async function handleSaveActivity(data: {
  name: string;
  description: string;
  suggestedTime: string;
  estimatedDurationMinutes: number | null;
  costEstimate: string;
  notes: string;
  actualCost: string;
}) {
  if (!editingActivity.value) return;

  try {
    await $fetch(
      `/api/trips/${tripId}/activities/${editingActivity.value.id}`,
      {
        method: "PUT",
        body: data,
      }
    );
    editModalOpen.value = false;

    // Recompute travel segments for the affected day
    const affectedDayId = findDayForActivity(editingActivity.value.id);
    editingActivity.value = null;
    if (affectedDayId) {
      await recomputeSegments(affectedDayId);
    }
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to update activity:", e);
  }
}

const { confirm } = useConfirm();

async function handleDeleteActivity(
  activity: (typeof allActivities.value)[number]
) {
  const ok = await confirm({
    title: "Delete activity",
    message: `Remove "${activity.name}" from this day?`,
    confirmText: "Delete",
    destructive: true,
  });
  if (!ok) return;

  const affectedDayId = findDayForActivity(activity.id);

  try {
    await $fetch(`/api/trips/${tripId}/activities/${activity.id}`, {
      method: "DELETE",
    });
    if (affectedDayId) {
      await recomputeSegments(affectedDayId);
    }
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to delete activity:", e);
  }
}

function handleActivityClick(
  activity: (typeof allActivities.value)[number]
) {
  highlightedActivityId.value = activity.id;
  if (tripMapRef.value && activity.lat && activity.lng) {
    tripMapRef.value.centerOnActivity(activity);
  }
}

function handleMarkerClick(
  activity: (typeof allActivities.value)[number]
) {
  highlightedActivityId.value = activity.id;

  const el = document.getElementById(`activity-${activity.id}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function handleAddActivity(dayId: string) {
  const day = sortedDays.value.find((d) => d.id === dayId);
  addActivityModal.value = {
    open: true,
    dayId,
    dayNumber: day?.dayNumber ?? 1,
  };
}

async function handleActivityAdded() {
  // Server already recomputes segments on activity add, just refresh data
  await refresh();
}

async function handleIdeasRefresh() {
  await refreshIdeas();
  await refresh();
}

function findDayForActivity(activityId: string): string | null {
  if (!trip.value?.days) return null;
  for (const day of trip.value.days) {
    if (day.activities.some((a) => a.id === activityId)) {
      return day.id;
    }
  }
  return null;
}

async function recomputeSegments(dayId: string) {
  try {
    await $fetch(`/api/trips/${tripId}/days/${dayId}/segments`, {
      method: "POST",
    });
  } catch (e: unknown) {
    console.error("Failed to recompute segments:", e);
  }
}
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="status === 'pending'" class="flex items-center justify-center py-24">
      <Icon name="lucide:loader" class="h-6 w-6 animate-spin text-terra-400" />
    </div>

    <!-- Not found -->
    <div v-else-if="!trip" class="py-24 text-center">
      <p class="text-sand-600">Trip not found.</p>
      <NuxtLink
        to="/dashboard"
        class="mt-4 inline-block text-sm font-medium text-terra-600 underline decoration-terra-300 transition hover:text-terra-700"
      >
        Back to dashboard
      </NuxtLink>
    </div>

    <!-- Trip detail -->
    <div v-else>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-3">
          <NuxtLink
            to="/dashboard"
            class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
          >
            <Icon name="lucide:arrow-left" class="h-5 w-5" />
          </NuxtLink>
          <div>
            <h1 class="font-display text-3xl text-sand-900">
              {{ trip.destination }}
            </h1>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-sand-500">
              <span class="flex items-center gap-1">
                <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
                {{ formatDateRange(trip.startDate, trip.endDate) }}
              </span>
              <span class="text-sand-300">|</span>
              <span
                class="inline-block rounded-full bg-sand-100 px-2.5 py-0.5 text-xs font-medium text-sand-700"
              >
                {{ trip.status }}
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="inline-block rounded-full bg-terra-50 px-3 py-1 text-xs font-medium text-terra-700">
            {{ sortedDays.length }} days
          </span>
          <button
            class="inline-flex items-center gap-1 rounded-full bg-sand-100 px-3 py-1 text-xs font-medium text-sand-600 transition hover:bg-sand-200"
            @click="showPrefsEditor = !showPrefsEditor"
          >
            <Icon name="lucide:sliders-horizontal" class="h-3 w-3" />
            {{ trip.preferences?.budget || "moderate" }} · {{ trip.preferences?.pace || "moderate" }}
          </button>
          <button
            class="inline-flex items-center gap-1 rounded-full bg-sand-100 px-3 py-1 text-xs font-medium text-sand-600 transition hover:bg-sand-200"
            title="Export trip as KML for Google My Maps"
            @click="handleExportKml"
          >
            <Icon name="lucide:download" class="h-3 w-3" />
            Export KML
          </button>
        </div>
      </div>

      <!-- Preferences editor -->
      <div v-if="showPrefsEditor" class="mt-4 rounded-xl border border-sand-200 bg-white p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-sand-900">Trip Preferences</h3>
          <button class="text-xs text-sand-400 hover:text-sand-600" @click="showPrefsEditor = false">
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-sand-500">Budget</label>
            <select
              :value="trip.preferences?.budget || ''"
              class="mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus"
              @change="updatePreference('budget', ($event.target as HTMLSelectElement).value)"
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
              class="mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus"
              @change="updatePreference('pace', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Any</option>
              <option value="relaxed">Relaxed</option>
              <option value="moderate">Moderate</option>
              <option value="packed">Packed</option>
            </select>
          </div>
        </div>
        <p class="mt-2 text-xs text-sand-400">AI suggestions will respect these preferences.</p>
      </div>

      <!-- Tabs -->
      <div class="mt-6">
        <TripDetailTabs v-model="activeTab" />
      </div>

      <!-- Itinerary tab -->
      <div v-if="activeTab === 'itinerary'" class="mt-6">
        <!-- Day tabs (client-only to avoid hydration mismatch with sessionStorage) -->
        <ClientOnly>
          <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            <button
              v-for="day in sortedDays"
              :key="day.id"
              class="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition"
              :class="day.id === activeDayId
                ? 'bg-terra-500 text-white shadow-sm'
                : 'bg-sand-100 text-sand-600 hover:bg-sand-200'"
              @click="activeDayId = day.id"
            >
              Day {{ day.dayNumber }} &middot; {{ formatDayDate(day.date) }}
            </button>
          </div>
        </ClientOnly>

        <!-- AI prompt bar -->
        <div v-if="activeDay" class="mt-4">
          <form class="flex items-center gap-2" @submit.prevent="handleAiSubmit">
            <div class="relative flex-1">
              <Icon name="lucide:sparkles" class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-terra-400" />
              <input
                v-model="aiPrompt"
                type="text"
                :disabled="aiLoading"
                :placeholder="activeDayHasActivities
                  ? 'Add a ramen spot, remove the temple, optimize the route...'
                  : 'What would you like to do today? e.g., street food tour, temple visits...'"
                class="input-focus block w-full rounded-xl border border-sand-200 bg-white py-2.5 pl-10 pr-4 text-sm text-sand-900 placeholder:text-sand-400 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              :disabled="aiLoading || !aiPrompt.trim()"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-terra-500 text-white transition hover:bg-terra-600 disabled:opacity-50"
            >
              <Icon
                :name="aiLoading ? 'lucide:loader' : 'lucide:arrow-up'"
                class="h-4 w-4"
                :class="{ 'animate-spin': aiLoading }"
              />
            </button>
          </form>

          <!-- AI feedback messages -->
          <div v-if="aiMessage && !aiError" class="mt-2 flex items-center gap-2 rounded-lg bg-forest-50 px-3 py-2 text-sm text-forest-700">
            <Icon name="lucide:check-circle" class="h-4 w-4 shrink-0" />
            <span>{{ aiMessage }}</span>
            <button class="ml-auto shrink-0 text-forest-400 hover:text-forest-700" @click="aiMessage = ''">
              <Icon name="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>
          <div v-if="aiError" class="mt-2 flex items-start gap-2 rounded-lg bg-terra-50 px-3 py-2 text-sm text-terra-600">
            <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ aiError }}</span>
            <button class="ml-auto shrink-0 text-terra-400 hover:text-terra-700" @click="aiError = ''">
              <Icon name="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- Active day content -->
        <div v-if="activeDay" class="mt-4">
          <div class="flex flex-col gap-6 lg:flex-row">
            <!-- Left: Accommodation + Activities + Ideas -->
            <div class="flex-1 space-y-6 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto lg:pr-4">
              <!-- Accommodation -->
              <AccommodationSection
                :trip-id="tripId"
                :day-id="activeDay.id"
                :accommodation-name="activeDay.accommodationName"
                :accommodation-address="activeDay.accommodationAddress"
                :accommodation-lat="activeDay.accommodationLat"
                :accommodation-lng="activeDay.accommodationLng"
                @updated="refresh"
              />

              <!-- AI loading overlay -->
              <AiLoadingOverlay
                :visible="aiLoading"
                :mode="aiLoadingMode"
              />

              <!-- Activities for this day -->
              <DaySection
                v-show="!aiLoading"
                :day="activeDay"
                :trip-id="tripId"
                :highlighted-activity-id="highlightedActivityId"
                :travel-segments="activeDay.travelSegments"
                @edit-activity="handleEditActivity"
                @delete-activity="handleDeleteActivity"
                @click-activity="handleActivityClick"
                @add-activity="handleAddActivity"
              />

              <!-- Ideas bucket -->
              <IdeasBucket
                v-show="!aiLoading"
                :trip-id="tripId"
                :ideas="ideas ?? []"
                :days="sortedDays.map((d) => ({ id: d.id, dayNumber: d.dayNumber, date: d.date }))"
                :active-day-id="activeDayId"
                @refresh="handleIdeasRefresh"
              />
            </div>

            <!-- Right: Map -->
            <div class="lg:w-[480px] lg:shrink-0">
              <div class="sticky top-8 h-[400px] overflow-hidden rounded-2xl shadow-lg lg:h-[calc(100vh-320px)]">
                <TripMap
                  ref="tripMapRef"
                  :activities="activeDayActivities"
                  @marker-click="handleMarkerClick"
                />
              </div>
            </div>
          </div>

          <!-- Stats -->
          <div class="mt-8">
            <TripStats
              :days="sortedDays"
              :budget="trip.budget ?? null"
              :currency-code="trip.currencyCode ?? 'USD'"
              :total-expenses="totalExpenses"
            />
          </div>
        </div>
      </div>

      <!-- Notes tab -->
      <div v-else-if="activeTab === 'notes'" class="mt-8 space-y-6 max-w-3xl">
        <TripNotesPanel
          :trip-id="tripId"
          :notes="trip.tripNotes ?? null"
        />
        <ChecklistPanel :trip-id="tripId" />
      </div>

      <!-- Expenses tab -->
      <div v-else-if="activeTab === 'expenses'" class="mt-8 max-w-3xl">
        <ExpenseTracker
          :trip-id="tripId"
          :budget="trip.budget ?? null"
          :currency-code="trip.currencyCode ?? 'USD'"
        />
      </div>
    </div>

    <!-- Edit modal -->
    <EditActivityModal
      :activity="editingActivity"
      :open="editModalOpen"
      @save="handleSaveActivity"
      @close="editModalOpen = false"
    />

    <!-- Add activity modal -->
    <AddActivityModal
      :open="addActivityModal.open"
      :trip-id="tripId"
      :day-id="addActivityModal.dayId"
      :day-number="addActivityModal.dayNumber"
      @added="handleActivityAdded"
      @close="addActivityModal.open = false"
    />

  </div>
</template>
