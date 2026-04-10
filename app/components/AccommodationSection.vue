<script setup lang="ts">
import type { PlaceResult } from "~/composables/usePlaceSearch"

const props = defineProps<{
  tripId: string
  dayId: string
  accommodationName: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
}>()

const emit = defineEmits<{
  updated: []
}>()

const isEditing = ref(false)
const isSaving = ref(false)

const hasAccommodation = computed(() => !!props.accommodationName)

async function handlePlaceSelect(place: PlaceResult) {
  isSaving.value = true
  try {
    await $fetch(`/api/trips/${props.tripId}/days/${props.dayId}/accommodation`, {
      method: "PUT",
      body: {
        accommodationName: place.name,
        accommodationAddress: place.formattedAddress ?? null,
        accommodationLat: place.lat,
        accommodationLng: place.lng,
      },
    })
    isEditing.value = false
    emit("updated")
  } catch (e: unknown) {
    console.error("Failed to set accommodation:", e)
  } finally {
    isSaving.value = false
  }
}

async function handleClear() {
  isSaving.value = true
  try {
    await $fetch(`/api/trips/${props.tripId}/days/${props.dayId}/accommodation`, {
      method: "PUT",
      body: {
        accommodationName: null,
        accommodationAddress: null,
        accommodationLat: null,
        accommodationLng: null,
      },
    })
    isEditing.value = false
    emit("updated")
  } catch (e: unknown) {
    console.error("Failed to clear accommodation:", e)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div>
    <!-- No accommodation set -->
    <div
      v-if="!hasAccommodation && !isEditing"
      class="rounded-2xl border-2 border-dashed border-terra-300 bg-sand-100 p-4"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-sand-500">
          <Icon name="lucide:bed-double" class="h-4 w-4" />
          <span>Where are you staying?</span>
        </div>
        <button
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-sand-700 hover:bg-sand-200"
          @click="isEditing = true"
        >
          Set accommodation
        </button>
      </div>
    </div>

    <!-- Inline search -->
    <div v-else-if="isEditing" class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm font-medium text-sand-700">
          <Icon name="lucide:bed-double" class="h-4 w-4" />
          <span>Search accommodation</span>
        </div>
        <button class="text-xs text-sand-400 hover:text-sand-600" @click="isEditing = false">
          Cancel
        </button>
      </div>
      <PlaceSearchInput placeholder="Search for a hotel, Airbnb..." @select="handlePlaceSelect" />
    </div>

    <!-- Accommodation set -->
    <div v-else class="rounded-2xl border border-ocean-200 bg-ocean-50 p-4">
      <div class="flex items-start justify-between">
        <div class="flex items-start gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ocean-100">
            <Icon name="lucide:bed-double" class="h-4 w-4 text-ocean-600" />
          </div>
          <div>
            <p class="text-sm font-medium text-sand-900">
              {{ accommodationName }}
            </p>
            <p v-if="accommodationAddress" class="mt-0.5 text-xs text-sand-500">
              {{ accommodationAddress }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="rounded px-2 py-1 text-xs text-sand-500 hover:bg-ocean-100 hover:text-sand-700"
            :disabled="isSaving"
            @click="isEditing = true"
          >
            Edit
          </button>
          <button
            class="rounded px-2 py-1 text-xs text-sand-400 hover:bg-ocean-100 hover:text-red-600"
            :disabled="isSaving"
            @click="handleClear"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
