<script setup lang="ts">
import draggable from "vuedraggable"

interface Activity {
  id: string
  name: string
  type: string
  description: string | null
  lat: number | null
  lng: number | null
  address: string | null
  rating: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
  actualCost: string | null
  photos: string[] | null
  openingHours: string[] | null
  tags: string[] | null
  placeId: string | null
  sortOrder: number
}

interface TravelSegment {
  fromActivityId: string
  durationSeconds?: number | null
  durationText: string | null
  distanceText: string | null
  mode?: "driving" | "walking" | "transit" | "bicycling" | null
}

interface Day {
  id: string
  dayNumber: number
  date: string
  notes: string | null
  activities: Activity[]
}

interface Participant {
  userId: string
  name: string
  image: string | null
}

interface Member {
  userId: string
  user: { name: string; image: string | null }
}

const props = defineProps<{
  day: Day
  tripId: string
  currencyCode?: string
  highlightedActivityId?: string | null
  travelSegments?: TravelSegment[]
  travelMode?: "driving" | "walking" | "transit" | "bicycling"
  readonly?: boolean
  participantsMap?: Record<string, Participant[]>
  members?: Member[]
}>()

const emit = defineEmits<{
  editActivity: [activity: Activity]
  deleteActivity: [activity: Activity]
  clickActivity: [activity: Activity]
  addActivity: [dayId: string]
  reordered: []
  updateNotes: [notes: string]
  toggleParticipant: [activityId: string, userId: string]
}>()

// Drag and drop
const localActivities = ref([...props.day.activities])
const isDragging = ref(false)

watch(
  () => props.day.activities,
  (newActivities) => {
    // Don't clobber the local order mid-drag; otherwise keep the rendered list
    // (localActivities drives the <draggable>) in sync with the source of truth.
    if (!isDragging.value) localActivities.value = [...newActivities]
  },
  { deep: true, immediate: true },
)

async function handleDragEnd() {
  isDragging.value = false
  const newOrder = localActivities.value.map((a) => a.id)

  // Check if order actually changed
  const oldOrder = props.day.activities.map((a) => a.id)
  if (JSON.stringify(newOrder) === JSON.stringify(oldOrder)) return

  try {
    await $fetch(`/api/trips/${props.tripId}/days/${props.day.id}/reorder`, {
      method: "PUT",
      body: { activityIds: newOrder },
    })
    emit("reordered")
  } catch (e) {
    console.error("Failed to reorder:", e)
    // Revert on failure
    localActivities.value = [...props.day.activities]
  }
}

function getSegmentForActivity(activityId: string): TravelSegment | undefined {
  return props.travelSegments?.find((s) => s.fromActivityId === activityId)
}

function getPairMapsUrl(from: Activity, to: Activity | undefined): string | null {
  if (!to || from.lat == null || from.lng == null || to.lat == null || to.lng == null) return null
  return getGoogleMapsDirectionsUrl([from, to], "transit")
}

/**
 * Returns true if this activity's time is earlier than the previous activity's
 * end time (start + duration), indicating an out-of-order schedule.
 */
function isOutOfOrder(index: number): boolean {
  if (index === 0) return false
  const prev = localActivities.value[index - 1]
  const curr = localActivities.value[index]
  if (!prev || !curr) return false
  if (!prev.suggestedTime || !curr.suggestedTime) return false

  const prevMinutes = timeToMinutes(prev.suggestedTime)
  const currMinutes = timeToMinutes(curr.suggestedTime)
  if (prevMinutes === null || currMinutes === null) return false

  // Compare current start vs previous start (+ duration if available)
  const segment = getSegmentForActivity(prev.id)
  const travelMinutes = segment?.durationSeconds ? Math.ceil(segment.durationSeconds / 60) : 0
  const prevEnd = prevMinutes + (prev.estimatedDurationMinutes ?? 0) + travelMinutes
  return currMinutes < prevEnd
}

function timeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return parseInt(match[1]!) * 60 + parseInt(match[2]!)
}
</script>

<template>
  <div>
    <div v-if="!readonly" class="mb-3">
      <textarea
        :value="day.notes ?? ''"
        placeholder="Day notes... (dietary needs, booking confirmations, reminders)"
        rows="2"
        class="block w-full resize-none rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm text-sand-600 placeholder:text-sand-400 input-focus"
        @blur="$emit('updateNotes', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
    <p v-else-if="day.notes" class="mb-3 text-sm text-sand-600 italic">
      {{ day.notes }}
    </p>

    <div v-if="day.activities.length" class="pl-3 sm:pl-5 border-l-2 border-terra-200">
      <draggable
        v-model="localActivities"
        item-key="id"
        handle=".drag-handle"
        :disabled="readonly"
        ghost-class="opacity-30"
        drag-class="shadow-lg"
        :force-fallback="true"
        :scroll-sensitivity="200"
        :scroll-speed="15"
        :delay="200"
        :delay-on-touch-only="true"
        :touch-start-threshold="5"
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
              <span>Schedule conflict: activities overlap in time</span>
            </div>

            <div :id="`activity-${activity.id}`">
              <ActivityCard
                :activity="activity"
                :index="index"
                :currency-code="currencyCode"
                :highlighted="activity.id === highlightedActivityId"
                :readonly="readonly"
                :participants="participantsMap?.[activity.id]"
                :members="members"
                @edit="emit('editActivity', $event)"
                @delete="emit('deleteActivity', $event)"
                @click="emit('clickActivity', $event)"
                @toggle-participant="
                  (activityId: string, userId: string) =>
                    emit('toggleParticipant', activityId, userId)
                "
              />
            </div>
            <TravelSegmentDivider
              v-if="index < localActivities.length - 1 && !isDragging"
              :duration-text="getSegmentForActivity(activity.id)?.durationText ?? null"
              :distance-text="getSegmentForActivity(activity.id)?.distanceText ?? null"
              :mode="getSegmentForActivity(activity.id)?.mode ?? travelMode ?? null"
              :preferred-mode="travelMode ?? null"
              :maps-url="getPairMapsUrl(activity, localActivities[index + 1])"
            />
          </div>
        </template>
      </draggable>

      <button
        v-if="!readonly"
        class="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-terra-200 text-sm text-sand-600 transition hover:border-terra-400 hover:text-terra-500 focus-ring"
        @click="emit('addActivity', day.id)"
      >
        <Icon name="lucide:plus" class="h-3 w-3" />
        Add activity
      </button>
    </div>

    <div
      v-else
      class="rounded-xl border border-dashed border-sand-200 p-6 text-center text-sm text-sand-500"
    >
      No activities planned for this day
    </div>
  </div>
</template>
