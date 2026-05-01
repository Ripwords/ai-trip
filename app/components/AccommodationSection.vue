<script setup lang="ts">
import type { PlaceResult } from "~/composables/usePlaceSearch"

interface DaySummary {
  id: string
  dayNumber: number
  date: string
  accommodationName: string | null
}

const props = defineProps<{
  tripId: string
  dayId: string
  accommodationName: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
  days: DaySummary[]
}>()

const emit = defineEmits<{
  updated: []
}>()

const { confirm } = useConfirm()

const isEditing = ref(false)
const isSaving = ref(false)
const pendingPlace = ref<PlaceResult | null>(null)
const nights = ref(1)

const hasAccommodation = computed(() => !!props.accommodationName)

const sortedDays = computed(() =>
  props.days.toSorted((a, b) => a.dayNumber - b.dayNumber),
)

const currentDayIndex = computed(() =>
  sortedDays.value.findIndex((d) => d.id === props.dayId),
)

const maxNights = computed(() => {
  const idx = currentDayIndex.value
  if (idx < 0) return 1
  return sortedDays.value.length - idx
})

const targetDays = computed(() => {
  const idx = currentDayIndex.value
  if (idx < 0) return []
  return sortedDays.value.slice(idx, idx + nights.value)
})

const conflictDays = computed(() =>
  targetDays.value.filter(
    (d) => d.id !== props.dayId && d.accommodationName && d.accommodationName.length > 0,
  ),
)

watch(isEditing, (val) => {
  if (!val) {
    pendingPlace.value = null
    nights.value = 1
  }
})

function handlePlaceSelect(place: PlaceResult) {
  pendingPlace.value = place
  nights.value = 1
}

function decNights() {
  if (nights.value > 1) nights.value--
}

function incNights() {
  if (nights.value < maxNights.value) nights.value++
}

async function handleSave() {
  if (!pendingPlace.value) return

  if (conflictDays.value.length > 0) {
    const list = conflictDays.value
      .map((d) => `Day ${d.dayNumber}: ${d.accommodationName}`)
      .join("\n")
    const ok = await confirm({
      title: "Replace existing accommodations?",
      message: `The following days already have an accommodation set and will be replaced:\n\n${list}`,
      confirmText: "Replace",
      destructive: true,
    })
    if (!ok) return
  }

  const place = pendingPlace.value
  isSaving.value = true
  try {
    if (nights.value === 1) {
      await $fetch(`/api/trips/${props.tripId}/days/${props.dayId}/accommodation`, {
        method: "PUT",
        body: {
          accommodationName: place.name,
          accommodationAddress: place.formattedAddress ?? null,
          accommodationLat: place.lat,
          accommodationLng: place.lng,
        },
      })
    } else {
      await $fetch(`/api/trips/${props.tripId}/accommodation/range`, {
        method: "PUT",
        body: {
          dayIds: targetDays.value.map((d) => d.id),
          accommodationName: place.name,
          accommodationAddress: place.formattedAddress ?? null,
          accommodationLat: place.lat,
          accommodationLng: place.lng,
        },
      })
    }
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

    <!-- Inline search / nights selection -->
    <div v-else-if="isEditing" class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm font-medium text-sand-700">
          <Icon name="lucide:bed-double" class="h-4 w-4" />
          <span>{{ pendingPlace ? "Stay how many nights?" : "Search accommodation" }}</span>
        </div>
        <button class="text-xs text-sand-400 hover:text-sand-600" @click="isEditing = false">
          Cancel
        </button>
      </div>

      <PlaceSearchInput
        v-if="!pendingPlace"
        placeholder="Search for a hotel, Airbnb..."
        @select="handlePlaceSelect"
      />

      <div v-else class="rounded-2xl border border-ocean-200 bg-ocean-50 p-4 space-y-3">
        <div class="flex items-start gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ocean-100">
            <Icon name="lucide:bed-double" class="h-4 w-4 text-ocean-600" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium text-sand-900 truncate">
              {{ pendingPlace.name }}
            </p>
            <p
              v-if="pendingPlace.formattedAddress"
              class="mt-0.5 text-xs text-sand-500 truncate"
            >
              {{ pendingPlace.formattedAddress }}
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-ocean-200 pt-3">
          <div class="flex items-center gap-3">
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-sand-300 bg-white text-sand-700 hover:bg-sand-50 disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="nights <= 1 || isSaving"
              aria-label="Decrease nights"
              @click="decNights"
            >
              <Icon name="lucide:minus" class="h-4 w-4" />
            </button>
            <div class="text-sm font-medium text-sand-900 min-w-[60px] text-center">
              {{ nights }} {{ nights === 1 ? "night" : "nights" }}
            </div>
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-sand-300 bg-white text-sand-700 hover:bg-sand-50 disabled:opacity-40 disabled:cursor-not-allowed"
              :disabled="nights >= maxNights || isSaving"
              aria-label="Increase nights"
              @click="incNights"
            >
              <Icon name="lucide:plus" class="h-4 w-4" />
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="text-xs text-sand-400 hover:text-sand-600"
              :disabled="isSaving"
              @click="pendingPlace = null"
            >
              Change
            </button>
            <button
              class="rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600 disabled:opacity-50"
              :disabled="isSaving"
              @click="handleSave"
            >
              {{ isSaving ? "Saving..." : "Save" }}
            </button>
          </div>
        </div>

        <p v-if="nights > 1" class="text-xs text-sand-500">
          Applies to days
          {{ targetDays[0]?.dayNumber }}–{{ targetDays[targetDays.length - 1]?.dayNumber }}
        </p>
      </div>
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
