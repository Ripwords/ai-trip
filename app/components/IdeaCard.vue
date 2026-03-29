<script setup lang="ts">
interface Idea {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

interface Day {
  id: string;
  dayNumber: number;
  date: string;
}

const props = defineProps<{
  idea: Idea;
  days: Day[];
}>();

const emit = defineEmits<{
  delete: [ideaId: string];
  promote: [payload: { ideaId: string; itineraryDayId: string }];
}>();

const selectedDayId = ref(props.days[0]?.id ?? "");

watch(
  () => props.days,
  (days) => {
    if (days.length > 0 && !days.some((d) => d.id === selectedDayId.value)) {
      selectedDayId.value = days[0].id;
    }
  }
);

const typeBadgeClasses: Record<string, string> = {
  attraction: "bg-ocean-50 text-ocean-700",
  restaurant: "bg-terra-50 text-terra-700",
  hotel: "bg-ocean-50 text-ocean-700",
  transport: "bg-sand-100 text-sand-700",
  shopping: "bg-terra-50 text-terra-600",
  entertainment: "bg-forest-50 text-forest-700",
};

function getBadgeClass(type: string): string {
  return typeBadgeClasses[type] || "bg-sand-100 text-sand-700";
}

function handlePromote() {
  if (!selectedDayId.value) return;
  emit("promote", { ideaId: props.idea.id, itineraryDayId: selectedDayId.value });
}
</script>

<template>
  <div class="rounded-xl border border-sand-200 bg-sand-50 p-3">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h4 class="text-sm font-semibold text-sand-900 truncate">{{ idea.name }}</h4>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <span
            v-if="idea.type"
            class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
            :class="getBadgeClass(idea.type)"
          >
            {{ formatType(idea.type) }}
          </span>
          <a
            v-if="idea.address"
            :href="idea.lat && idea.lng
              ? `https://www.google.com/maps/search/?api=1&query=${idea.lat},${idea.lng}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(idea.address)}`"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-ocean-600 truncate hover:text-terra-600"
            title="Open in Google Maps"
            @click.stop
          >
            <span class="truncate underline decoration-ocean-300 underline-offset-2 hover:decoration-terra-400">{{ idea.address }}</span>
            <Icon name="lucide:external-link" class="h-2.5 w-2.5 shrink-0 opacity-50" />
          </a>
        </div>
      </div>
      <button
        class="shrink-0 rounded p-1 text-sand-400 hover:bg-red-50 hover:text-red-600"
        title="Delete"
        @click="emit('delete', idea.id)"
      >
        <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="mt-2 flex items-center gap-2">
      <select
        v-model="selectedDayId"
        class="block flex-1 rounded-lg border border-sand-300 px-2 py-1 text-xs input-focus"
      >
        <option v-for="day in days" :key="day.id" :value="day.id">
          Day {{ day.dayNumber }}
        </option>
      </select>
      <button
        class="rounded-lg bg-terra-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-terra-600"
        @click="handlePromote"
      >
        Move
      </button>
    </div>
  </div>
</template>
