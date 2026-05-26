<script setup lang="ts">
import type { LayoverInfo } from "../composables/useLayoverDetection"

const props = defineProps<{
  layover: LayoverInfo
}>()

// Fetch visa status for the layover country to pass to AI tips
const visaStatus = ref<string | null>(null)
if (props.layover.country) {
  useFetch("/api/visa/check", {
    query: { destination: props.layover.country },
  }).then(({ data }) => {
    if (data.value) {
      visaStatus.value = (data.value as { visaStatus?: string }).visaStatus ?? null
    }
  })
}

const showAiTips = ref(false)
const aiTipsLoading = ref(false)
const aiTips = ref<{
  recommendation: string
  suggestions: string[]
  transitInfo: string
  returnBy: string
} | null>(null)
const aiError = ref<string | null>(null)

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const recommendationStyle = computed(() => {
  switch (props.layover.recommendation) {
    case "stay":
      return "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
    case "tight":
      return "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
    case "explore":
      return "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
  }
})

const recommendationIcon = computed(() => {
  switch (props.layover.recommendation) {
    case "stay":
      return "lucide:shield"
    case "tight":
      return "lucide:clock"
    case "explore":
      return "lucide:map-pin"
  }
})

async function fetchAiTips() {
  if (aiTips.value || aiTipsLoading.value) {
    showAiTips.value = !showAiTips.value
    return
  }

  showAiTips.value = true
  aiTipsLoading.value = true
  aiError.value = null

  try {
    const result = await $fetch("/api/ai/layover-tips", {
      method: "POST",
      body: {
        airport: props.layover.airport,
        durationMinutes: props.layover.durationMinutes ?? 180,
        visaStatus: visaStatus.value,
        arrivalTime: props.layover.arrivalTime,
      },
    })
    aiTips.value = result
  } catch (err: unknown) {
    const errorData = err as { statusCode?: number; data?: { message?: string } }
    if (errorData.statusCode === 429) {
      aiError.value = "AI usage limit reached for this month."
    } else {
      aiError.value = "Failed to load AI tips. Try again later."
    }
  } finally {
    aiTipsLoading.value = false
  }
}
</script>

<template>
  <div class="rounded-xl border border-dashed border-sand-300 bg-sand-50/50 p-4">
    <div class="flex items-center gap-3">
      <!-- Clock icon -->
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sand-100">
        <Icon name="lucide:clock" class="h-4 w-4 text-sand-500" />
      </div>

      <!-- Main info -->
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold text-sand-900">
            <template v-if="layover.durationMinutes !== null">
              {{ formatDuration(layover.durationMinutes) }} layover at {{ layover.airport }}
            </template>
            <template v-else> Connection at {{ layover.airport }} </template>
          </span>
          <VisaBadge v-if="layover.country" :destination-country="layover.country" />
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <span
            v-if="layover.durationMinutes !== null"
            class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
            :class="recommendationStyle"
          >
            <Icon :name="recommendationIcon" class="h-3 w-3" />
            {{ layover.recommendationLabel }}
          </span>
        </div>
      </div>

      <!-- AI tips button -->
      <button
        class="shrink-0 text-xs font-medium text-terra-500 transition hover:text-terra-600"
        @click="fetchAiTips"
      >
        <template v-if="aiTipsLoading">Loading...</template>
        <template v-else>AI tips {{ showAiTips ? "↑" : "→" }}</template>
      </button>
    </div>

    <!-- Expanded AI tips -->
    <div v-if="showAiTips && (aiTips || aiError)" class="mt-3 border-t border-sand-200 pt-3">
      <div v-if="aiError" class="text-xs text-red-500">{{ aiError }}</div>
      <div v-else-if="aiTips" class="space-y-2 text-xs text-sand-700">
        <p class="font-medium text-sand-900">{{ aiTips.recommendation }}</p>
        <ul class="list-inside list-disc space-y-1">
          <li v-for="(suggestion, idx) in aiTips.suggestions" :key="idx">{{ suggestion }}</li>
        </ul>
        <p v-if="aiTips.transitInfo">
          <span class="font-medium text-sand-900">Getting around:</span> {{ aiTips.transitInfo }}
        </p>
        <p v-if="aiTips.returnBy">
          <span class="font-medium text-sand-900">Head back by:</span> {{ aiTips.returnBy }}
        </p>
      </div>
    </div>
  </div>
</template>
