<script setup lang="ts">
import type { PlaceResult } from "~/composables/usePlaceSearch";

const props = defineProps<{
  open: boolean;
  tripId: string;
  dayId: string;
  dayNumber: number;
}>();

const emit = defineEmits<{
  added: [];
  close: [];
}>();

const mode = ref<"search" | "manual">("search");
const selectedPlace = ref<PlaceResult | null>(null);
const submitting = ref(false);

// Manual mode fields
const name = ref("");
const type = ref("attraction");
const description = ref("");

const activityTypes = [
  "attraction",
  "restaurant",
  "hotel",
  "transport",
  "shopping",
  "entertainment",
];

function handlePlaceSelect(place: PlaceResult) {
  selectedPlace.value = place;
}

async function handleSearchSubmit() {
  if (!selectedPlace.value) return;
  submitting.value = true;
  try {
    await $fetch(`/api/trips/${props.tripId}/activities`, {
      method: "POST",
      body: {
        itineraryDayId: props.dayId,
        name: selectedPlace.value.name,
        type: selectedPlace.value.types?.[0] ?? "attraction",
        placeId: selectedPlace.value.placeId,
        lat: selectedPlace.value.lat,
        lng: selectedPlace.value.lng,
        address: selectedPlace.value.formattedAddress ?? null,
        rating: selectedPlace.value.rating ?? undefined,
      },
    });
    emit("added");
    emit("close");
    resetForm();
  } catch (e: unknown) {
    console.error("Failed to add activity:", e);
  } finally {
    submitting.value = false;
  }
}

async function handleManualSubmit() {
  if (!name.value.trim()) return;
  submitting.value = true;
  try {
    await $fetch(`/api/trips/${props.tripId}/activities`, {
      method: "POST",
      body: {
        itineraryDayId: props.dayId,
        name: name.value,
        type: type.value,
        description: description.value || null,
      },
    });
    emit("added");
    emit("close");
    resetForm();
  } catch (e: unknown) {
    console.error("Failed to add activity:", e);
  } finally {
    submitting.value = false;
  }
}

function resetForm() {
  mode.value = "search";
  selectedPlace.value = null;
  name.value = "";
  type.value = "attraction";
  description.value = "";
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
        <h2 class="text-lg font-display text-sand-900">
          Add Activity to Day {{ dayNumber }}
        </h2>

        <!-- Mode toggle -->
        <div class="mt-4 flex rounded-lg border border-sand-200 p-0.5">
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="mode === 'search' ? 'bg-terra-500 text-white' : 'text-sand-600 hover:text-sand-900'"
            @click="mode = 'search'"
          >
            Search place
          </button>
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="mode === 'manual' ? 'bg-terra-500 text-white' : 'text-sand-600 hover:text-sand-900'"
            @click="mode = 'manual'"
          >
            Manual entry
          </button>
        </div>

        <!-- Search mode -->
        <div v-if="mode === 'search'" class="mt-4 space-y-4">
          <PlaceSearchInput
            placeholder="Search for a place..."
            @select="handlePlaceSelect"
          />

          <div
            v-if="selectedPlace"
            class="rounded-lg border border-terra-200 bg-terra-50 p-3"
          >
            <p class="text-sm font-medium text-sand-900">{{ selectedPlace.name }}</p>
            <p v-if="selectedPlace.formattedAddress" class="mt-0.5 text-xs text-sand-500">
              {{ selectedPlace.formattedAddress }}
            </p>
            <div v-if="selectedPlace.rating" class="mt-1 flex items-center gap-1 text-xs text-sand-500">
              <Icon name="lucide:star" class="h-3 w-3 text-terra-400" />
              {{ selectedPlace.rating }}
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-2">
            <button
              type="button"
              class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              type="button"
              :disabled="!selectedPlace || submitting"
              class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
              @click="handleSearchSubmit"
            >
              Add
            </button>
          </div>
        </div>

        <!-- Manual mode -->
        <form v-else class="mt-4 space-y-4" @submit.prevent="handleManualSubmit">
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
            <label class="block text-sm font-medium text-sand-700">Type</label>
            <select
              v-model="type"
              class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            >
              <option v-for="t in activityTypes" :key="t" :value="t">
                {{ t }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-sand-700">Description</label>
            <textarea
              v-model="description"
              rows="3"
              class="mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

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
              :disabled="submitting"
              class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
