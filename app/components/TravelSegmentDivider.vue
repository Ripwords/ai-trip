<script setup lang="ts">
type Mode = "driving" | "walking" | "transit" | "bicycling"

const props = defineProps<{
  durationText: string | null
  distanceText: string | null
  mode?: Mode | null
  preferredMode?: Mode | null
  mapsUrl?: string | null
}>()

const modeIcons: Record<Mode, string> = {
  driving: "lucide:car",
  walking: "lucide:person-standing",
  transit: "lucide:train",
  bicycling: "lucide:bike",
}

const modeNouns: Record<Mode, string> = {
  driving: "driving",
  walking: "walking",
  transit: "transit",
  bicycling: "biking",
}

const hasData = computed(() => Boolean(props.durationText || props.distanceText))
const displayMode = computed<Mode>(() => props.mode ?? props.preferredMode ?? "driving")
// Transit durations come from Google Maps directly (legacy Distance Matrix
// transit data is too sparse to be useful), so always render the link state
// for transit pairs — regardless of whether stale walking-fallback data exists.
const showTransitLink = computed(() => props.preferredMode === "transit" && Boolean(props.mapsUrl))
const showEmpty = computed(
  () => !hasData.value && !showTransitLink.value && Boolean(props.preferredMode ?? props.mode),
)
</script>

<template>
  <a
    v-if="showTransitLink"
    :href="mapsUrl ?? undefined"
    target="_blank"
    rel="noopener noreferrer"
    class="group flex items-center gap-2 py-2 pl-7 text-sm text-sand-500 transition hover:text-terra-600"
  >
    <div class="h-5 border-l border-dashed border-sand-300" />
    <Icon name="lucide:train" class="h-3.5 w-3.5 text-sand-400" />
    <span>Transit time in Maps</span>
    <Icon
      name="lucide:external-link"
      class="h-3 w-3 text-sand-400 transition group-hover:text-terra-500"
    />
  </a>
  <div v-else-if="hasData" class="flex items-center gap-2 py-2 pl-7 text-sm text-sand-500">
    <div class="h-5 border-l border-dashed border-sand-300" />
    <Icon :name="modeIcons[displayMode]" class="h-3.5 w-3.5 text-sand-400" />
    <span>
      <template v-if="durationText">~{{ durationText }}</template>
      <template v-if="durationText && distanceText"> &middot; </template>
      <template v-if="distanceText">{{ distanceText }}</template>
    </span>
  </div>
  <div v-else-if="showEmpty" class="flex items-center gap-2 py-2 pl-7 text-sm italic text-sand-500">
    <div class="h-5 border-l border-dashed border-sand-300" />
    <Icon :name="modeIcons[displayMode]" class="h-3.5 w-3.5 text-sand-400" />
    <span>No {{ modeNouns[displayMode] }} route found</span>
  </div>
</template>
