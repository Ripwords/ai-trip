<script setup lang="ts">
const props = defineProps<{
  destination: string;
  hasActivities: boolean;
}>();

const emit = defineEmits<{
  select: [prompt: string];
}>();

const emptyDaySuggestions = computed(() => [
  `Plan my full day in ${props.destination}`,
  "Find breakfast, lunch, and dinner spots",
  "Mix cultural sites with food stops",
  "Suggest hidden gems and local favorites",
]);

const withActivitiesSuggestions = [
  "Add a coffee shop nearby",
  "Move dinner to 7 PM",
  "Remove the museum",
  "Optimize the route",
  "Fill the gaps",
  "Find a hotel nearby",
];

const suggestions = computed(() =>
  props.hasActivities ? withActivitiesSuggestions : emptyDaySuggestions.value
);
</script>

<template>
  <div class="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:px-0">
    <button
      v-for="suggestion in suggestions"
      :key="suggestion"
      class="shrink-0 whitespace-nowrap rounded-full border border-sand-200 bg-sand-50 px-3 py-1 text-xs text-sand-600 transition hover:border-terra-300 hover:text-terra-700"
      @click="emit('select', suggestion)"
    >
      {{ suggestion }}
    </button>
  </div>
</template>
