<script setup lang="ts">
interface Activity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  rating: string | null;
  suggestedTime: string | null;
  estimatedDurationMinutes: number | null;
  costEstimate: string | null;
  notes: string | null;
  actualCost: string | null;
  photos: string[];
  sortOrder: number;
}

function getGoogleMapsUrl(activity: Activity): string {
  // Use query_place_id for precise matching, with query as fallback display
  // The api=1 format works cross-platform (iOS, Android, web)
  if (activity.placeId && activity.lat && activity.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}&query_place_id=${activity.placeId}`;
  }
  if (activity.lat && activity.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}`;
  }
  if (activity.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name)}`;
}

const props = defineProps<{
  activity: Activity;
  index: number;
  highlighted?: boolean;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  edit: [activity: Activity];
  delete: [activity: Activity];
  click: [activity: Activity];
}>();

const typeBadgeClasses: Record<string, string> = {
  attraction: "bg-ocean-50 text-ocean-700",
  restaurant: "bg-terra-50 text-terra-700",
  hotel: "bg-ocean-50 text-ocean-700",
  transport: "bg-sand-100 text-sand-700",
  shopping: "bg-terra-50 text-terra-600",
  entertainment: "bg-forest-50 text-forest-700",
  park: "bg-forest-50 text-forest-700",
  nature: "bg-forest-50 text-forest-700",
};

function getBadgeClass(type: string): string {
  return typeBadgeClasses[type] || "bg-sand-100 text-sand-700";
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function starFill(rating: string | null, position: number): "full" | "half" | "empty" {
  if (!rating) return "empty";
  const val = parseFloat(rating);
  if (position <= Math.floor(val)) return "full";
  if (position === Math.floor(val) + 1 && val % 1 >= 0.25) return "half";
  return "empty";
}
</script>

<template>
  <div
    class="group rounded-2xl border bg-white p-5 transition cursor-pointer hover:shadow-md"
    :class="highlighted ? 'border-terra-500 bg-terra-50 shadow-md' : 'border-sand-200 hover:border-sand-300'"
    @click="emit('click', activity)"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3 min-w-0">
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
        >
          {{ index + 1 }}
        </span>
        <div class="min-w-0">
          <h4 class="text-base font-semibold text-sand-900 truncate">
            {{ activity.name }}
          </h4>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <span
              class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
              :class="getBadgeClass(activity.type)"
            >
              {{ formatType(activity.type) }}
            </span>
            <span
              v-if="activity.suggestedTime"
              class="flex items-center gap-1 text-sm text-sand-500"
            >
              <Icon name="lucide:clock" class="h-3.5 w-3.5" />
              {{ formatTime12h(activity.suggestedTime) }}
            </span>
            <span
              v-if="activity.estimatedDurationMinutes"
              class="text-sm text-sand-500"
            >
              {{ formatDuration(activity.estimatedDurationMinutes) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="!readonly" class="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          class="rounded-lg p-1.5 text-sand-400 hover:bg-terra-50 hover:text-terra-600"
          title="Edit"
          @click.stop="emit('edit', activity)"
        >
          <Icon name="lucide:edit" class="h-4 w-4" />
        </button>
        <button
          class="rounded-lg p-1.5 text-sand-400 hover:bg-red-50 hover:text-red-600"
          title="Delete"
          @click.stop="emit('delete', activity)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <p
      v-if="activity.description"
      class="mt-2 text-sm leading-relaxed text-sand-600 line-clamp-2"
    >
      {{ activity.description }}
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-3 text-sm text-sand-500">
      <a
        :href="getGoogleMapsUrl(activity)"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 truncate text-sand-500 transition hover:text-terra-600"
        title="Open in Google Maps"
        @click.stop
      >
        <Icon name="lucide:map-pin" class="h-3.5 w-3.5 shrink-0" />
        <span v-if="activity.address" class="truncate">{{ activity.address }}</span>
        <span v-else class="truncate">View on map</span>
        <Icon name="lucide:external-link" class="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
      </a>
      <span v-if="activity.costEstimate" class="flex items-center gap-1">
        <Icon name="lucide:dollar-sign" class="h-3.5 w-3.5" />
        {{ parseFloat(activity.costEstimate).toFixed(0) }}
      </span>
      <span v-if="activity.actualCost" class="flex items-center gap-1 text-forest-600 font-medium">
        Paid: ${{ parseFloat(activity.actualCost).toFixed(0) }}
      </span>
      <span v-if="activity.notes" class="flex items-center gap-1" title="Has notes">
        <Icon name="lucide:sticky-note" class="h-3.5 w-3.5" />
      </span>
      <span v-if="activity.rating" class="flex items-center gap-0.5">
        <template v-for="i in 5" :key="i">
          <span v-if="starFill(activity.rating, i) === 'half'" class="relative h-3.5 w-3.5">
            <Icon name="lucide:star" class="absolute inset-0 h-3.5 w-3.5 text-sand-300" />
            <span class="absolute inset-0 overflow-hidden" style="width: 50%">
              <Icon name="mdi:star" class="h-3.5 w-3.5 text-terra-400" />
            </span>
          </span>
          <Icon
            v-else
            :name="starFill(activity.rating, i) === 'full' ? 'mdi:star' : 'lucide:star'"
            class="h-3.5 w-3.5"
            :class="starFill(activity.rating, i) === 'full' ? 'text-terra-400' : 'text-sand-300'"
          />
        </template>
        <span class="ml-1">{{ activity.rating }}</span>
      </span>
    </div>
  </div>
</template>
