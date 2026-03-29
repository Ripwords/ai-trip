<script setup lang="ts">
interface Activity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  suggestedTime: string | null;
  estimatedDurationMinutes: number | null;
  costEstimate: string | null;
  notes: string | null;
  actualCost: string | null;
  openingHours?: string[] | null;
  priceLevel?: number | null;
  photos?: string[];
}

function formatPriceLevel(level: number): string {
  return "$".repeat(Math.min(level, 4));
}

const props = defineProps<{
  activity: Activity | null;
  open: boolean;
}>();

const emit = defineEmits<{
  save: [data: {
    name: string;
    description: string;
    suggestedTime: string;
    estimatedDurationMinutes: number | null;
    costEstimate: string;
    notes: string;
    actualCost: string;
  }];
  close: [];
}>();

const name = ref("");
const description = ref("");
const suggestedTime = ref("");
const estimatedDurationMinutes = ref<number | null>(null);
const costEstimate = ref("");
const notes = ref("");
const actualCost = ref("");

watch(
  () => props.activity,
  (activity) => {
    if (activity) {
      name.value = activity.name;
      description.value = activity.description ?? "";
      suggestedTime.value = activity.suggestedTime ?? "";
      estimatedDurationMinutes.value = activity.estimatedDurationMinutes;
      costEstimate.value = activity.costEstimate ?? "";
      notes.value = activity.notes ?? "";
      actualCost.value = activity.actualCost ?? "";
    }
  },
  { immediate: true }
);

function handleSave() {
  emit("save", {
    name: name.value,
    description: description.value || null,
    suggestedTime: suggestedTime.value || null,
    estimatedDurationMinutes: estimatedDurationMinutes.value,
    costEstimate: costEstimate.value || null,
    notes: notes.value || null,
    actualCost: actualCost.value || null,
  });
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        class="fixed inset-0 bg-black/40"
        @click="emit('close')"
      />
      <div class="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl mx-4">
        <h2 class="text-lg font-display text-sand-900">Edit Activity</h2>

        <!-- Photos strip (read-only from Google Maps) -->
        <div v-if="activity?.photos?.length" class="mt-3 flex gap-2 overflow-x-auto scrollbar-thin">
          <img
            v-for="(photo, i) in activity.photos.slice(0, 3)"
            :key="i"
            :src="`https://places.googleapis.com/v1/${photo}/media?maxWidthPx=200&key=${useRuntimeConfig().public.googleMapsApiKey}`"
            :alt="activity.name"
            class="h-20 w-28 shrink-0 rounded-xl object-cover"
            loading="lazy"
          />
        </div>

        <form class="mt-4 space-y-4" @submit.prevent="handleSave">
          <div>
            <label class="block text-sm font-medium text-sand-700">Name</label>
            <input
              v-model="name"
              type="text"
              required
              class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-sand-700">Description</label>
            <textarea
              v-model="description"
              rows="3"
              class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-sand-700">Suggested Time</label>
              <input
                v-model="suggestedTime"
                type="time"
                class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-sand-700">Duration (min)</label>
              <input
                v-model.number="estimatedDurationMinutes"
                type="number"
                min="0"
                class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-sand-700">Cost Estimate</label>
              <input
                v-model="costEstimate"
                type="text"
                placeholder="e.g. 25.00"
                class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-sand-700">Actual Cost</label>
              <input
                v-model="actualCost"
                type="text"
                placeholder="e.g. 30.00"
                class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-sand-700">Notes</label>
            <textarea
              v-model="notes"
              rows="2"
              placeholder="Any notes about this activity..."
              class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

          <!-- Opening hours (read-only from Google Maps) -->
          <details v-if="activity?.openingHours?.length" class="group">
            <summary class="flex cursor-pointer items-center gap-1 text-sm font-medium text-sand-700">
              <Icon name="lucide:clock" class="h-3.5 w-3.5" />
              Opening Hours
              <span v-if="activity?.priceLevel != null && activity.priceLevel > 0" class="ml-2 text-xs font-medium text-forest-600">
                {{ formatPriceLevel(activity.priceLevel) }}
              </span>
              <Icon name="lucide:chevron-down" class="ml-auto h-3.5 w-3.5 transition group-open:rotate-180" />
            </summary>
            <ul class="mt-2 space-y-0.5 text-sm text-sand-600">
              <li v-for="(hour, i) in activity.openingHours" :key="i">{{ hour }}</li>
            </ul>
          </details>

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
              class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
