<script setup lang="ts">
const props = defineProps<{
  tripId: string
  days: { id: string; dayNumber: number; activities: { id: string }[] }[]
  disabled: boolean
  aiRemaining?: number
}>()

const emit = defineEmits<{
  done: []
}>()

const { confirm } = useConfirm()

const isGenerating = ref(false)
const currentDayIndex = ref(0)
const generationError = ref("")

const emptyDays = computed(() => props.days.filter((d) => d.activities.length === 0))

async function handleGenerate() {
  if (emptyDays.value.length === 0) return

  // Pre-check quota
  if (props.aiRemaining != null && props.aiRemaining < emptyDays.value.length) {
    const ok = await confirm({
      title: "Not enough AI prompts",
      message: `You need ${emptyDays.value.length} prompts but only have ${props.aiRemaining} remaining this month. Generate as many as possible?`,
      confirmText: "Continue anyway",
    })
    if (!ok) return
  } else {
    const ok = await confirm({
      title: "Generate full itinerary",
      message: `This will use AI to fill ${emptyDays.value.length} empty day${emptyDays.value.length > 1 ? "s" : ""}. Each day costs 1 AI prompt.`,
      confirmText: "Generate",
    })
    if (!ok) return
  }

  isGenerating.value = true
  generationError.value = ""

  for (let i = 0; i < emptyDays.value.length; i++) {
    const day = emptyDays.value[i]!
    currentDayIndex.value = i
    try {
      await $fetch(`/api/trips/${props.tripId}/days/${day.id}/ai`, {
        method: "POST",
        body: { prompt: "Plan this day with a good mix of activities, food, and sightseeing" },
      })
    } catch {
      generationError.value = `Generated ${i} of ${emptyDays.value.length} days. Day ${day.dayNumber} failed — try again manually.`
      isGenerating.value = false
      emit("done")
      return
    }
  }

  isGenerating.value = false
  emit("done")
}
</script>

<template>
  <div v-if="emptyDays.length >= 2">
    <button
      v-if="!isGenerating"
      :disabled="disabled"
      class="inline-flex items-center gap-1 text-xs text-sand-400 transition hover:text-terra-600 disabled:opacity-40 disabled:cursor-not-allowed"
      @click="handleGenerate"
    >
      <Icon name="lucide:sparkles" class="h-3 w-3" />
      <span class="hidden sm:inline">Generate all {{ emptyDays.length }} empty days</span>
      <span class="sm:hidden">Generate all days</span>
    </button>
    <span v-else class="inline-flex items-center gap-1.5 text-xs font-medium text-terra-600">
      <Icon name="lucide:loader" class="h-3 w-3 animate-spin" />
      Generating Day {{ emptyDays[currentDayIndex]?.dayNumber }} ({{ currentDayIndex + 1 }}/{{
        emptyDays.length
      }})...
    </span>
    <p v-if="generationError" class="mt-1 text-xs text-terra-500">{{ generationError }}</p>
  </div>
</template>
