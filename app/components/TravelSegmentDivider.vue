<script setup lang="ts">
defineProps<{
  durationText: string | null;
  distanceText: string | null;
}>();
</script>

<template>
  <div
    v-if="durationText || distanceText"
    class="flex items-center gap-2 py-2 pl-7 text-sm text-sand-500"
  >
    <div class="h-5 border-l border-dashed border-sand-300" />
    <Icon name="lucide:car" class="h-3.5 w-3.5 text-sand-400" />
    <span>
      <template v-if="durationText">~{{ durationText }}</template>
      <template v-if="durationText && distanceText"> &middot; </template>
      <template v-if="distanceText">{{ distanceText }}</template>
    </span>
  </div>
</template>
