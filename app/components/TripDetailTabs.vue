<script setup lang="ts">
defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const tabs = [
  { value: "overview", label: "Overview", icon: "lucide:layout-dashboard" },
  { value: "itinerary", label: "Itinerary", icon: "lucide:map" },
  { value: "notes", label: "Notes", icon: "lucide:notebook-text" },
  { value: "expenses", label: "Expenses", icon: "lucide:wallet" },
  { value: "reservations", label: "Bookings", icon: "lucide:ticket" },
  { value: "documents", label: "Docs", icon: "lucide:paperclip" },
  { value: "team", label: "Team", icon: "lucide:users" },
  { value: "flights", label: "Flights", icon: "lucide:plane" },
]
</script>

<template>
  <div class="flex gap-1.5 overflow-x-auto scrollbar-thin sm:gap-2">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      class="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition sm:gap-1.5 sm:px-4 sm:py-2 sm:text-sm"
      :class="
        modelValue === tab.value
          ? 'bg-terra-500 text-white'
          : 'bg-sand-200 text-sand-700 hover:bg-sand-300'
      "
      @click="emit('update:modelValue', tab.value)"
    >
      <Icon :name="tab.icon" class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      {{ tab.label }}
    </button>
  </div>
</template>
