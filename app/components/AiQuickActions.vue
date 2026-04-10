<script setup lang="ts">
defineProps<{
  disabled: boolean
  hasActivities: boolean
}>()

const emit = defineEmits<{
  fillGaps: []
  optimizeRoute: []
}>()
</script>

<template>
  <div class="flex items-center gap-1.5">
    <button
      :disabled="disabled"
      class="inline-flex items-center gap-1 rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-xs font-medium text-sand-600 transition hover:border-terra-300 hover:text-terra-700 disabled:opacity-40 disabled:cursor-not-allowed"
      @click="emit('fillGaps')"
    >
      <Icon name="lucide:wand-2" class="h-3 w-3" />
      Fill Gaps
    </button>
    <button
      :disabled="disabled || !hasActivities"
      class="inline-flex items-center gap-1 rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-xs font-medium text-sand-600 transition hover:border-terra-300 hover:text-terra-700 disabled:opacity-40 disabled:cursor-not-allowed"
      @click="emit('optimizeRoute')"
    >
      <Icon name="lucide:route" class="h-3 w-3" />
      Optimize
    </button>
  </div>
</template>
