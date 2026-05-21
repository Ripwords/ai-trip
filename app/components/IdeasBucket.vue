<script setup lang="ts">
interface Idea {
  id: string
  name: string
  type: string | null
  address: string | null
  lat: number | null
  lng: number | null
  placeId: string | null
}

interface Day {
  id: string
  dayNumber: number
  date: string
}

const props = defineProps<{
  tripId: string
  ideas: Idea[]
  days: Day[]
  activeDayId: string | null
}>()

const emit = defineEmits<{
  refresh: []
}>()

async function handlePlaceSelect(place: {
  name: string
  placeId: string
  lat: number
  lng: number
  rating?: number
  formattedAddress?: string
  types?: string[]
}) {
  if (!props.activeDayId) return

  try {
    // Add directly to the current day as an activity
    await $fetch(`/api/trips/${props.tripId}/activities`, {
      method: "POST",
      body: {
        itineraryDayId: props.activeDayId,
        name: place.name,
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        address: place.formattedAddress ?? null,
        type: place.types?.[0] ?? "attraction",
        rating: place.rating ?? undefined,
      },
    })
    emit("refresh")
  } catch (e: unknown) {
    console.error("Failed to add activity:", e)
  }
}

async function handleSaveToIdeas(place: {
  name: string
  placeId: string
  lat: number
  lng: number
  rating?: number
  formattedAddress?: string
  types?: string[]
}) {
  try {
    await $fetch(`/api/trips/${props.tripId}/ideas`, {
      method: "POST",
      body: {
        name: place.name,
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        address: place.formattedAddress ?? null,
        type: place.types?.[0] ?? null,
        rating: place.rating ?? undefined,
      },
    })
    emit("refresh")
  } catch (e: unknown) {
    console.error("Failed to add idea:", e)
  }
}

async function handlePromote(payload: { ideaId: string; itineraryDayId: string }) {
  try {
    await $fetch(`/api/trips/${props.tripId}/ideas/${payload.ideaId}/promote`, {
      method: "POST",
      body: { itineraryDayId: payload.itineraryDayId },
    })
    emit("refresh")
  } catch (e: unknown) {
    console.error("Failed to promote idea:", e)
  }
}

async function handleDelete(ideaId: string) {
  try {
    await $fetch(`/api/trips/${props.tripId}/ideas/${ideaId}`, {
      method: "DELETE",
    })
    emit("refresh")
  } catch (e: unknown) {
    console.error("Failed to delete idea:", e)
  }
}

const activeDayLabel = computed(() => {
  const day = props.days.find((d) => d.id === props.activeDayId)
  return day ? `Day ${day.dayNumber}` : ""
})
</script>

<template>
  <div class="space-y-3">
    <PlaceSearchInput
      :placeholder="`Search to add to ${activeDayLabel}...`"
      @select="handlePlaceSelect"
    />

    <div v-if="ideas.length" class="space-y-2">
      <div class="flex items-center gap-1.5 px-1">
        <Icon name="lucide:lightbulb" class="h-3.5 w-3.5 text-terra-400" />
        <span class="text-xs font-medium text-sand-500">Saved ideas ({{ ideas.length }})</span>
      </div>
      <IdeaCard
        v-for="idea in ideas"
        :key="idea.id"
        :idea="idea"
        :days="days"
        @delete="handleDelete"
        @promote="handlePromote"
      />
    </div>
  </div>
</template>
