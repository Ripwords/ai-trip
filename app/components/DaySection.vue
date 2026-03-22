<script setup lang="ts">
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
}>();

const emit = defineEmits<{
  editActivity: [activity: Activity];
  deleteActivity: [activity: Activity];
  clickActivity: [activity: Activity];
  addActivity: [dayId: string];
}>();

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
    <div class="flex items-center gap-3 mb-3">
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
    </div>

    <p v-if="day.notes" class="mb-3 text-sm text-sand-600 italic">
      {{ day.notes }}
    </p>

    <div v-if="day.activities.length" class="space-y-3 pl-5 border-l-2 border-terra-200">
      <template
        v-for="(activity, index) in day.activities"
        :key="activity.id"
      >
        <!-- Time conflict warning -->
        <div
          v-if="isOutOfOrder(index)"
          class="flex items-center gap-1.5 rounded-lg bg-terra-50 px-3 py-2 text-sm text-terra-700"
        >
          <Icon name="lucide:alert-triangle" class="h-3.5 w-3.5 shrink-0" />
          <span>
            Starts before previous activity ends — consider using
            <strong>Optimize Route</strong> to fix the schedule
          </span>
        </div>

        <div :id="`activity-${activity.id}`">
          <ActivityCard
            :activity="activity"
            :index="index"
            :highlighted="activity.id === highlightedActivityId"
            @edit="emit('editActivity', $event)"
            @delete="emit('deleteActivity', $event)"
            @click="emit('clickActivity', $event)"
          />
        </div>
        <TravelSegmentDivider
          v-if="index < day.activities.length - 1"
          :duration-text="getSegmentForActivity(activity.id)?.durationText ?? null"
          :distance-text="getSegmentForActivity(activity.id)?.distanceText ?? null"
        />
      </template>

      <button
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
