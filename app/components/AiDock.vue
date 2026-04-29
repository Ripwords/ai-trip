<script setup lang="ts">
import { BorderBeam } from "vue-border-beam"

const props = defineProps<{
  modelValue: string
  loading: boolean
  loadingMode: "generate" | "optimize" | "remove" | "reschedule"
  usageUsed: number | null
  usageLimit: number | null
  usageRemaining: number | null
  hasActivities: boolean
  destination: string
  feedbackMessage: string
  feedbackError: string
  undoAvailable: boolean
  undoing: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
  submit: [prompt: string]
  cancel: []
  undo: []
  dismissFeedback: []
  fillGaps: []
  optimizeRoute: []
  generateFull: []
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const hovered = ref(false)
const expanded = ref(false)

function expand() {
  expanded.value = true
  nextTick(() => inputEl.value?.focus())
}

function collapse() {
  if (props.loading) return
  expanded.value = false
  focused.value = false
  hovered.value = false
}

watch(
  () => props.loading,
  (isLoading) => {
    if (isLoading) expanded.value = true
  },
)

watch([() => props.feedbackMessage, () => props.feedbackError], ([m, e]) => {
  if (m || e) expanded.value = true
})

const limitReached = computed(() => (props.usageRemaining ?? 1) <= 0)

const stepSets = {
  generate: [
    "Searching travel blogs & local guides…",
    "Finding hidden gems & local favorites…",
    "Validating places on Google Maps…",
    "Building your itinerary…",
  ],
  optimize: [
    "Researching routes & transit options…",
    "Calculating optimal order…",
    "Assigning realistic times…",
  ],
  remove: ["Identifying activities to remove…", "Updating your itinerary…"],
  reschedule: ["Analyzing your current schedule…", "Adjusting times and order…"],
} as const

const cycleIndex = ref(0)
let cycleTimer: ReturnType<typeof setInterval> | null = null

function startCycle() {
  if (cycleTimer) clearInterval(cycleTimer)
  cycleIndex.value = 0
  cycleTimer = setInterval(() => {
    const steps = stepSets[props.loadingMode] ?? stepSets.generate
    cycleIndex.value = (cycleIndex.value + 1) % steps.length
  }, 2500)
}

function stopCycle() {
  if (cycleTimer) clearInterval(cycleTimer)
  cycleTimer = null
  cycleIndex.value = 0
}

watch(
  () => props.loading,
  (isLoading) => {
    if (isLoading) startCycle()
    else stopCycle()
  },
)

const loadingPlaceholder = computed(() => {
  const steps = stepSets[props.loadingMode] ?? stepSets.generate
  return steps[cycleIndex.value % steps.length]!
})

const placeholder = computed(() => {
  if (limitReached.value) return "Limit reached. Resets next month."
  if (props.loading) return loadingPlaceholder.value
  return props.hasActivities ? "Add, remove, reschedule, find a hotel…" : "What to do today?"
})

const showSuggestions = computed(
  () => !props.loading && (focused.value || hovered.value) && props.modelValue.trim().length === 0,
)

const feedbackVisible = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function clearToastTimer() {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
}

watch([() => props.feedbackMessage, () => props.feedbackError], ([message, error]) => {
  clearToastTimer()
  if (error) {
    feedbackVisible.value = true
  } else if (message) {
    feedbackVisible.value = true
    toastTimer = setTimeout(() => {
      emit("dismissFeedback")
    }, 6000)
  } else {
    feedbackVisible.value = false
  }
})

onUnmounted(() => {
  stopCycle()
  clearToastTimer()
})

const destinationRef = computed(() => props.destination)
const hasActivitiesRef = computed(() => props.hasActivities)
const { suggestions } = useAiPromptSuggestions(destinationRef, hasActivitiesRef)

function selectSuggestion(text: string) {
  emit("update:modelValue", text)
  nextTick(() => inputEl.value?.focus())
}

function handleSubmit() {
  if (props.loading || !props.modelValue.trim() || limitReached.value) return
  emit("submit", props.modelValue.trim())
}

function handleClick() {
  if (props.loading) {
    emit("cancel")
  } else {
    handleSubmit()
  }
}
</script>

<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="expanded"
      class="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px]"
      @click="collapse"
    />
  </Transition>

  <div
    class="pointer-events-none fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-6 sm:right-6"
    :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }"
  >
    <Transition name="dock-morph" mode="out-in">
      <button
        v-if="!expanded"
        key="fab"
        type="button"
        class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-terra-500 text-white shadow-lg transition-colors hover:bg-terra-600"
        title="Ask AI"
        @click="expand"
      >
        <Icon name="lucide:sparkles" class="h-5 w-5" />
      </button>

      <div
        v-else
        key="pill"
        class="pointer-events-auto flex w-[min(28rem,calc(100vw-2rem))] flex-col items-end gap-2"
      >
        <Transition
          mode="out-in"
          enter-active-class="duration-200 ease-out"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="duration-150 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div
            v-if="feedbackVisible && (feedbackMessage || feedbackError)"
            class="pointer-events-auto w-full"
          >
            <div
              v-if="feedbackError"
              class="flex items-start gap-2 rounded-xl bg-terra-50 px-3 py-2 text-sm text-terra-700 shadow-sm"
            >
              <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
              <span class="flex-1">{{ feedbackError }}</span>
              <button
                type="button"
                class="shrink-0 text-terra-400 hover:text-terra-700"
                @click="emit('dismissFeedback')"
              >
                <Icon name="lucide:x" class="h-3.5 w-3.5" />
              </button>
            </div>
            <div
              v-else
              class="flex items-center gap-2 rounded-xl bg-forest-50 px-3 py-2 text-sm text-forest-700 shadow-sm"
            >
              <Icon name="lucide:check-circle" class="h-4 w-4 shrink-0" />
              <span class="flex-1">{{ feedbackMessage }}</span>
              <button
                v-if="undoAvailable"
                type="button"
                :disabled="undoing"
                class="shrink-0 text-sm font-medium text-forest-700 underline underline-offset-2 hover:text-forest-900 disabled:opacity-50"
                @click="emit('undo')"
              >
                <span v-if="undoing">Undoing…</span>
                <span v-else>Undo</span>
              </button>
              <button
                type="button"
                class="shrink-0 text-forest-400 hover:text-forest-700"
                @click="emit('dismissFeedback')"
              >
                <Icon name="lucide:x" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div
            v-else-if="showSuggestions"
            class="pointer-events-auto flex w-full flex-wrap justify-end gap-1.5"
          >
            <button
              type="button"
              :disabled="loading"
              class="rounded-full border border-stone-200 bg-white/95 px-3 py-1 text-xs text-stone-800 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
              @mousedown.prevent
              @click="emit('generateFull')"
            >
              <Icon name="lucide:sparkles" class="mr-1 inline h-3 w-3 text-terra-500" />
              Generate full itinerary
            </button>
            <button
              v-for="s in suggestions"
              :key="s"
              type="button"
              class="rounded-full border border-stone-200 bg-white/95 px-3 py-1 text-xs text-stone-700 shadow-sm transition hover:border-terra-300 hover:text-terra-700"
              @mousedown.prevent
              @click="selectSuggestion(s)"
            >
              {{ s }}
            </button>
          </div>
        </Transition>

        <div class="pointer-events-auto w-full">
          <BorderBeam
            size="sm"
            color-variant="sunset"
            theme="dark"
            :brightness="0.45"
            :strength="0.4"
            :saturation="0.9"
            :duration="4"
            class="dock-beam w-full"
          >
            <div
              class="flex items-center gap-2 rounded-full bg-sand-900 py-2 pl-2 pr-2"
              @mouseenter="hovered = true"
              @mouseleave="hovered = false"
            >
              <button
                type="button"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sand-50 transition hover:bg-sand-50/15 disabled:opacity-50"
                :disabled="loading"
                title="Close"
                @click="collapse"
              >
                <Icon name="lucide:x" class="h-4 w-4" />
              </button>
              <Icon
                name="lucide:sparkles"
                class="h-4 w-4 shrink-0 text-terra-400"
                :class="{ 'animate-spin': loading }"
              />
              <input
                ref="inputEl"
                :value="modelValue"
                type="text"
                :disabled="loading || limitReached"
                :placeholder="placeholder"
                class="min-w-0 flex-1 border-none bg-transparent text-sm text-sand-50 placeholder:text-sand-50/80 focus:outline-none disabled:opacity-70"
                @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
                @focus="focused = true"
                @blur="focused = false"
                @keydown.enter.prevent="handleSubmit"
              />
              <span
                v-if="usageUsed != null && usageLimit != null"
                class="shrink-0 text-[10px] tabular-nums"
                :class="
                  (usageRemaining ?? 1) <= 10 ? 'font-medium text-terra-500' : 'text-sand-50/70'
                "
                :title="`${usageUsed}/${usageLimit} AI prompts used this month`"
              >
                {{ usageUsed }}/{{ usageLimit }}
              </span>
              <button
                type="button"
                :disabled="!loading && (!modelValue.trim() || limitReached)"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50"
                :class="
                  loading ? 'bg-sand-600 hover:bg-sand-500' : 'bg-terra-500 hover:bg-terra-600'
                "
                :title="loading ? 'Cancel' : 'Submit'"
                @click="handleClick"
              >
                <Icon :name="loading ? 'lucide:x' : 'lucide:arrow-up'" class="h-4 w-4" />
              </button>
            </div>
          </BorderBeam>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dock-beam {
  border-radius: 9999px;
}

.dock-morph-enter-active,
.dock-morph-leave-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: bottom right;
  will-change: transform, opacity;
}

.dock-morph-enter-from,
.dock-morph-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

.dock-morph-enter-to,
.dock-morph-leave-from {
  opacity: 1;
  transform: scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .dock-morph-enter-active,
  .dock-morph-leave-active {
    transition: opacity 0.15s ease-out;
  }
  .dock-morph-enter-from,
  .dock-morph-leave-to {
    transform: none;
  }
  .animate-spin {
    animation: none;
  }
}
</style>
