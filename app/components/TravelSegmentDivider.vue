<script setup lang="ts">
type Mode = "driving" | "walking" | "transit" | "bicycling"

const props = defineProps<{
  durationText: string | null
  distanceText: string | null
  mode?: Mode | null
  preferredMode?: Mode | null
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
const isFallback = computed(() =>
  Boolean(hasData.value && props.preferredMode && props.mode && props.preferredMode !== props.mode),
)
const showEmpty = computed(() => !hasData.value && Boolean(props.preferredMode ?? props.mode))
</script>

<template>
  <div v-if="hasData" class="flex items-center gap-2 py-2 pl-7 text-sm text-sand-500">
    <div class="h-5 border-l border-dashed border-sand-300" />
    <Icon :name="modeIcons[displayMode]" class="h-3.5 w-3.5 text-sand-400" />
    <span>
      <template v-if="durationText">~{{ durationText }}</template>
      <template v-if="durationText && distanceText"> &middot; </template>
      <template v-if="distanceText">{{ distanceText }}</template>
      <template v-if="isFallback && preferredMode">
        &middot;
        <span class="italic text-sand-400">no {{ modeNouns[preferredMode] }} route</span>
      </template>
    </span>
  </div>
  <div v-else-if="showEmpty" class="flex items-center gap-2 py-2 pl-7 text-sm italic text-sand-400">
    <div class="h-5 border-l border-dashed border-sand-300" />
    <Icon :name="modeIcons[displayMode]" class="h-3.5 w-3.5 text-sand-400" />
    <span>No {{ modeNouns[displayMode] }} route found</span>
  </div>
</template>
