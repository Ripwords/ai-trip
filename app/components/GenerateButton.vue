<script setup lang="ts">
defineProps<{
  tripId: string;
  loading: boolean;
  hasActivities: boolean;
}>();

const emit = defineEmits<{
  generate: [];
}>();
</script>

<template>
  <button
    :disabled="loading"
    class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
    :class="
      hasActivities
        ? 'border border-terra-500 text-terra-500 hover:bg-terra-50'
        : 'bg-terra-500 text-white hover:bg-terra-600'
    "
    @click="emit('generate')"
  >
    <Icon
      v-if="loading"
      name="lucide:loader"
      class="h-4 w-4 animate-spin"
    />
    <Icon v-else name="lucide:navigation" class="h-4 w-4" />
    {{ loading ? "Generating..." : hasActivities ? "AI Fill Gaps" : "AI Generate" }}
  </button>
</template>
