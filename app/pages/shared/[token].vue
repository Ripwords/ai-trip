<script setup lang="ts">
definePageMeta({ layout: "default" });

const route = useRoute();
const token = route.params.token as string;

const { data: trip, error } = await useFetch(`/api/shared/${token}`);

useHead({
  title: computed(() =>
    trip.value ? `${trip.value.destination} — Shared Trip` : "Shared Trip"
  ),
});

const activeDayId = ref<string | null>(null);

const sortedDays = computed(() => {
  if (!trip.value?.days) return [];
  return [...trip.value.days].sort((a: { dayNumber: number }, b: { dayNumber: number }) => a.dayNumber - b.dayNumber);
});

const activeDay = computed(() =>
  sortedDays.value.find((d: { id: string }) => d.id === activeDayId.value) ?? null
);

watch(
  sortedDays,
  (days) => {
    if (days.length > 0 && !activeDayId.value) {
      activeDayId.value = (days[0] as { id: string }).id;
    }
  },
  { immediate: true }
);

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} - ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

function formatDayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8">
    <div v-if="error" class="text-center">
      <h1 class="font-display text-2xl text-sand-900">Trip Not Found</h1>
      <p class="mt-2 text-sand-600">This shared link may have expired or been removed.</p>
    </div>

    <div v-else-if="trip">
      <!-- Header -->
      <div class="text-center">
        <h1 class="font-display text-3xl text-sand-900">{{ trip.destination }}</h1>
        <p class="mt-1 flex items-center justify-center gap-1 text-sm text-sand-500">
          <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
          {{ formatDateRange(trip.startDate, trip.endDate) }}
        </p>
        <span
          class="mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="getTripStatus(trip.startDate, trip.endDate).badgeClass"
        >
          {{ getTripStatus(trip.startDate, trip.endDate).label }}
        </span>
      </div>

      <!-- Day tabs -->
      <div class="mt-8 flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        <button
          v-for="day in sortedDays"
          :key="(day as any).id"
          class="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition"
          :class="(day as any).id === activeDayId
            ? 'bg-terra-500 text-white shadow-sm'
            : 'bg-sand-100 text-sand-600 hover:bg-sand-200'"
          @click="activeDayId = (day as any).id"
        >
          Day {{ (day as any).dayNumber }} &middot; {{ formatDayDate((day as any).date) }}
        </button>
      </div>

      <!-- Day content -->
      <div v-if="activeDay" class="mt-6 space-y-3">
        <div
          v-for="(activity, index) in (activeDay as any).activities"
          :key="activity.id"
          class="rounded-2xl border border-sand-200 bg-white p-5"
        >
          <div class="flex items-start gap-3">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white">
              {{ index + 1 }}
            </span>
            <div class="min-w-0">
              <h4 class="text-base font-semibold text-sand-900">{{ activity.name }}</h4>
              <p v-if="activity.description" class="mt-1 text-sm text-sand-600">{{ activity.description }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-sand-500">
                <span v-if="activity.suggestedTime" class="inline-flex items-center gap-1 rounded-full bg-terra-50 px-2.5 py-0.5 text-xs font-semibold text-terra-700">
                  <Icon name="lucide:clock" class="h-3 w-3" />
                  {{ formatTime12h(activity.suggestedTime) }}
                </span>
                <span v-if="activity.address" class="text-xs text-sand-500 truncate">{{ activity.address }}</span>
              </div>
            </div>
          </div>
        </div>
        <p v-if="!(activeDay as any).activities?.length" class="text-center text-sm text-sand-400 py-8">
          No activities planned for this day.
        </p>
      </div>
    </div>
  </div>
</template>
