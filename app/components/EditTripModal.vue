<script setup lang="ts">
interface TripLike {
  destination: string
  startDate: string
  endDate: string
}

interface DayToDelete {
  id: string
  dayNumber: number
  date: string
  activityCount: number
  activityNames: string[]
}

const props = defineProps<{
  open: boolean
  tripId: string
  trip: TripLike
}>()

const emit = defineEmits<{
  updated: [payload: unknown]
  close: []
}>()

const destination = ref(props.trip.destination)
const startDate = ref(props.trip.startDate)
const endDate = ref(props.trip.endDate)
const submitting = ref(false)
const error = ref<string | null>(null)

const stage = ref<"form" | "confirm">("form")
const daysToDelete = ref<DayToDelete[]>([])
const daysToAdd = ref(0)

// Keep the form in sync when the parent opens the modal for a different trip or
// after an external update.
watch(
  () => [props.open, props.trip],
  () => {
    if (props.open) {
      destination.value = props.trip.destination
      startDate.value = props.trip.startDate
      endDate.value = props.trip.endDate
      stage.value = "form"
      error.value = null
    }
  },
  { deep: true },
)

const datesChanged = computed(
  () => startDate.value !== props.trip.startDate || endDate.value !== props.trip.endDate,
)

const destinationChanged = computed(() => destination.value.trim() !== props.trip.destination)

const anyChange = computed(() => datesChanged.value || destinationChanged.value)

const rangeValid = computed(() => endDate.value >= startDate.value)

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

async function handleSubmit() {
  error.value = null
  if (!destination.value.trim()) {
    error.value = "Destination is required"
    return
  }
  if (!rangeValid.value) {
    error.value = "End date must be on or after start date"
    return
  }
  if (!anyChange.value) {
    emit("close")
    return
  }

  submitting.value = true
  try {
    if (datesChanged.value) {
      const preview = await $fetch<{ daysToDelete: DayToDelete[]; daysToAdd: number }>(
        `/api/trips/${props.tripId}/date-change-preview`,
        {
          query: { startDate: startDate.value, endDate: endDate.value },
        },
      )
      const destructive = preview.daysToDelete.filter((d) => d.activityCount > 0)
      if (destructive.length > 0) {
        daysToDelete.value = destructive
        daysToAdd.value = preview.daysToAdd
        stage.value = "confirm"
        submitting.value = false
        return
      }
    }
    await commitUpdate()
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save changes"
  } finally {
    submitting.value = false
  }
}

async function commitUpdate() {
  submitting.value = true
  try {
    const result = await $fetch(`/api/trips/${props.tripId}`, {
      method: "PUT",
      body: {
        destination: destination.value.trim(),
        startDate: startDate.value,
        endDate: endDate.value,
      },
    })
    emit("updated", result)
    emit("close")
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save changes"
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/40" @click="emit('close')" />
      <div class="relative z-10 mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <!-- Form stage -->
        <template v-if="stage === 'form'">
          <h2 class="text-lg font-display text-sand-900">Edit trip</h2>

          <form class="mt-4 space-y-4" @submit.prevent="handleSubmit">
            <div>
              <label class="block text-sm font-medium text-sand-700">Destination</label>
              <input
                v-model="destination"
                type="text"
                required
                class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-sand-700">Start date</label>
                <input
                  v-model="startDate"
                  type="date"
                  required
                  class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-sand-700">End date</label>
                <input
                  v-model="endDate"
                  type="date"
                  required
                  class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
                />
              </div>
            </div>

            <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

            <div class="flex justify-end gap-3 pt-2">
              <button
                type="button"
                class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
                @click="emit('close')"
              >
                Cancel
              </button>
              <button
                type="submit"
                :disabled="submitting || !rangeValid"
                class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </form>
        </template>

        <!-- Confirm stage -->
        <template v-else>
          <h2 class="text-lg font-display text-sand-900">This will delete activities</h2>
          <p class="mt-2 text-sm text-sand-600">
            Shrinking the date range removes these days and their activities:
          </p>

          <ul class="mt-4 space-y-2 max-h-64 overflow-y-auto">
            <li
              v-for="d in daysToDelete"
              :key="d.id"
              class="rounded-lg border border-red-200 bg-red-50 p-3"
            >
              <p class="text-sm font-medium text-red-900">
                Day {{ d.dayNumber }} ({{ formatDate(d.date) }})
              </p>
              <p class="mt-1 text-xs text-red-700">
                {{ d.activityCount }}
                {{ d.activityCount === 1 ? "activity" : "activities" }}:
                {{ d.activityNames.join(", ") }}
              </p>
            </li>
          </ul>

          <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

          <div class="flex justify-end gap-3 pt-4">
            <button
              type="button"
              class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
              @click="stage = 'form'"
            >
              Back
            </button>
            <button
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              @click="commitUpdate"
            >
              Delete and save
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
