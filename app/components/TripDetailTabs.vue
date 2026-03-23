<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const tabs = [
  { value: "itinerary", label: "Itinerary", icon: "lucide:map" },
  { value: "notes", label: "Notes & Lists", icon: "lucide:notebook-text" },
  { value: "expenses", label: "Expenses", icon: "lucide:wallet" },
  { value: "team", label: "Team", icon: "lucide:users" },
];
</script>

<template>
  <div class="flex gap-2 p-1">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      class="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition"
      :class="
        modelValue === tab.value
          ? 'bg-terra-500 text-white'
          : 'bg-sand-200 text-sand-700 hover:bg-sand-300'
      "
      @click="emit('update:modelValue', tab.value)"
    >
      <Icon :name="tab.icon" class="h-4 w-4" />
      {{ tab.label }}
    </button>
  </div>
</template>
