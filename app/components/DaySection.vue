<script setup lang="ts">
import draggable from "vuedraggable";

interface Activity {
  id: string;
  name: string;
  type: string;
  description: string | null;
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

interface TravelSegment {
  fromActivityId: string;
  durationText: string | null;
  distanceText: string | null;
}

interface Day {
  id: string;
  dayNumber: number;
  date: string;
  notes: string | null;
  activities: Activity[];
}

const props = defineProps<{
  day: Day;
  tripId: string;
  highlightedActivityId?: string | null;
  travelSegments?: TravelSegment[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  editActivity: [activity: Activity];
  deleteActivity: [activity: Activity];
  clickActivity: [activity: Activity];
  addActivity: [dayId: string];
  reordered: [];
}>();

const mapsUrl = computed(() => getGoogleMapsDirectionsUrl(props.day.activities));

// Drag and drop
const localActivities = ref([...props.day.activities]);
const isDragging = ref(false);

watch(() => props.day.activities, (newActivities) => {
  localActivities.value = [...newActivities];
}, { deep: true });

async function handleDragEnd() {
  isDragging.value = false;
  const newOrder = localActivities.value.map((a) => a.id);

  // Check if order actually changed
  const oldOrder = props.day.activities.map((a) => a.id);
  if (JSON.stringify(newOrder) === JSON.stringify(oldOrder)) return;

  try {
    await $fetch(`/api/trips/${props.tripId}/days/${props.day.id}/reorder`, {
      method: "PUT",
      body: { activityIds: newOrder },
    });
    emit("reordered");
  } catch (e) {
    console.error("Failed to reorder:", e);
    // Revert on failure
    localActivities.value = [...props.day.activities];
  }
}

function getSegmentForActivity(activityId: string): TravelSegment | undefined {
  return props.travelSegments?.find((s) => s.fromActivityId === activityId);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Returns true if this activity's time is earlier than the previous activity's
 * end time (start + duration), indicating an out-of-order schedule.
 */
function isOutOfOrder(index: number): boolean {
  if (index === 0) return false;
  const prev = props.day.activities[index - 1];
  const curr = props.day.activities[index];
  if (!prev.suggestedTime || !curr.suggestedTime) return false;

  const prevMinutes = timeToMinutes(prev.suggestedTime);
  const currMinutes = timeToMinutes(curr.suggestedTime);
  if (prevMinutes === null || currMinutes === null) return false;

  // Compare current start vs previous start (+ duration if available)
  const prevEnd = prevMinutes + (prev.estimatedDurationMinutes ?? 0);
  return currMinutes < prevEnd;
}

function timeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-terra-500 text-sm font-bold text-white"
        >
          {{ day.dayNumber }}
        </span>
        <div>
          <h3 class="text-base font-semibold text-sand-900">
            Day {{ day.dayNumber }}
          </h3>
          <p class="text-sm text-sand-500">{{ formatDate(day.date) }}</p>
        </div>
      </div>
      <a
        v-if="mapsUrl"
        :href="mapsUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1 text-xs font-medium text-sand-600 transition hover:bg-sand-200 hover:text-sand-800"
        title="Open this day's route in Google Maps"
      >
        <Icon name="lucide:navigation" class="h-3 w-3" />
        Open in Maps
      </a>
    </div>

    <p v-if="day.notes" class="mb-3 text-sm text-sand-600 italic">
      {{ day.notes }}
    </p>

    <div v-if="day.activities.length" class="pl-5 border-l-2 border-terra-200">
      <draggable
        v-model="localActivities"
        item-key="id"
        handle=".drag-handle"
        :disabled="readonly"
        ghost-class="opacity-30"
        drag-class="shadow-lg"
        class="space-y-3"
        @start="isDragging = true"
        @end="handleDragEnd"
      >
        <template #item="{ element: activity, index }">
          <div>
            <!-- Time conflict warning -->
            <div
              v-if="isOutOfOrder(index)"
              class="mb-2 flex items-center gap-1.5 rounded-lg bg-terra-50 px-3 py-2 text-sm text-terra-700"
            >
              <Icon name="lucide:alert-triangle" class="h-3.5 w-3.5 shrink-0" />
              <span>Schedule conflict — activities overlap in time</span>
            </div>

            <div :id="`activity-${activity.id}`" class="flex gap-1">
              <!-- Drag handle -->
              <div
                v-if="!readonly"
                class="drag-handle flex shrink-0 cursor-grab items-center px-0.5 text-sand-300 active:cursor-grabbing"
              >
                <Icon name="lucide:grip-vertical" class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <ActivityCard
                  :activity="activity"
                  :index="index"
                  :highlighted="activity.id === highlightedActivityId"
                  :readonly="readonly"
                  @edit="emit('editActivity', $event)"
                  @delete="emit('deleteActivity', $event)"
                  @click="emit('clickActivity', $event)"
                />
              </div>
            </div>
            <TravelSegmentDivider
              v-if="index < localActivities.length - 1 && !isDragging"
              :duration-text="getSegmentForActivity(activity.id)?.durationText ?? null"
              :distance-text="getSegmentForActivity(activity.id)?.distanceText ?? null"
            />
          </div>
        </template>
      </draggable>

      <button
        v-if="!readonly"
        class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-terra-200 py-2.5 text-sm text-sand-400 transition hover:border-terra-400 hover:text-terra-500"
        @click="emit('addActivity', day.id)"
      >
        <Icon name="lucide:plus" class="h-3 w-3" />
        Add activity
      </button>
    </div>

    <div
      v-else
      class="rounded-xl border border-dashed border-sand-200 p-6 text-center text-sm text-sand-400"
    >
      No activities planned for this day
    </div>
  </div>
</template>
