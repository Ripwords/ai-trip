<script setup lang="ts">
import { BorderBeam } from "vue-border-beam"
import type { Proposal } from "~/types/proposal"
import type { ReviewFinding } from "~/types/review"

export interface AiDockResponse {
  message: string
  proposals?: Proposal[]
  findings?: ReviewFinding[]
  intent?: string
}

const props = defineProps<{
  modelValue: string
  loading: boolean
  loadingMode: "generate" | "optimize" | "remove" | "reschedule" | "review"
  usageUsed: number | null
  usageLimit: number | null
  usageRemaining: number | null
  hasActivities: boolean
  destination: string
  feedbackMessage: string
  feedbackError: string
  undoAvailable: boolean
  undoing: boolean
  response: AiDockResponse | null
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
  applyProposal: [proposal: Proposal]
  dismissProposal: [proposalId: string]
  closeResponse: []
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
  review: [
    "Checking timing and overlaps…",
    "Reviewing travel segments…",
    "Scanning meals and start points…",
  ],
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
  return props.hasActivities ? "Ask, propose, or review…" : "Where shall we begin?"
})

const showSuggestions = computed(
  () =>
    !props.loading &&
    !props.response &&
    (focused.value || hovered.value) &&
    props.modelValue.trim().length === 0,
)

const appliedProposalIds = ref<Set<string>>(new Set())
const applyingProposalIds = ref<Set<string>>(new Set())

function isApplied(id: string) {
  return appliedProposalIds.value.has(id)
}
function isApplying(id: string) {
  return applyingProposalIds.value.has(id)
}

async function onApply(proposal: Proposal) {
  if (isApplied(proposal.id) || isApplying(proposal.id)) return
  applyingProposalIds.value.add(proposal.id)
  emit("applyProposal", proposal)
}

function markApplied(id: string) {
  applyingProposalIds.value.delete(id)
  appliedProposalIds.value.add(id)
}

function markApplyFailed(id: string) {
  applyingProposalIds.value.delete(id)
}

defineExpose({ markApplied, markApplyFailed })

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

// ── Proposal helpers ────────────────────────────────────────────────

const proposalKindMeta: Record<
  Proposal["kind"],
  { label: string; symbol: string; tone: "terra" | "ocean" | "forest" | "sand" }
> = {
  "add-activities": { label: "Addition", symbol: "+", tone: "terra" },
  "remove-activities": { label: "Removal", symbol: "−", tone: "sand" },
  reschedule: { label: "Reschedule", symbol: "↻", tone: "ocean" },
  "optimize-route": { label: "Route", symbol: "↗", tone: "ocean" },
  "set-accommodation": { label: "Accommodation", symbol: "✦", tone: "forest" },
}

function kindMeta(kind: Proposal["kind"]) {
  return proposalKindMeta[kind]
}

// ── Finding helpers ─────────────────────────────────────────────────

interface FindingGroup {
  id: string
  severity: ReviewFinding["severity"]
  title: string
  count: number
  dayNumber: number
  recommendation: string
  proposal: ReviewFinding["proposal"] | undefined
  sample: ReviewFinding
}

const groupedFindings = computed<FindingGroup[]>(() => {
  const all = props.response?.findings ?? []
  const order = { critical: 0, warning: 1, suggestion: 2 } as const
  const groups = new Map<string, FindingGroup>()
  for (const f of all) {
    const key = `${f.dayId}:${f.code}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      if (!existing.proposal && f.proposal) existing.proposal = f.proposal
    } else {
      groups.set(key, {
        id: key,
        severity: f.severity,
        title: f.title,
        count: 1,
        dayNumber: f.dayNumber,
        recommendation: f.recommendation,
        proposal: f.proposal,
        sample: f,
      })
    }
  }
  return Array.from(groups.values()).toSorted((a, b) => order[a.severity] - order[b.severity])
})

const severityMeta: Record<
  ReviewFinding["severity"],
  { label: string; ribbon: string; dot: string }
> = {
  critical: { label: "Critical", ribbon: "bg-terra-500", dot: "bg-terra-500" },
  warning: { label: "Warning", ribbon: "bg-sand-500", dot: "bg-sand-500" },
  suggestion: { label: "Suggestion", ribbon: "bg-ocean-400", dot: "bg-ocean-400" },
}
</script>

<template>
  <!-- Backdrop -->
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
      class="fixed inset-0 z-[60] bg-sand-900/55 backdrop-blur-[3px]"
      @click="collapse"
    />
  </Transition>

  <!-- Collapsed FAB -->
  <Transition name="fab-pop">
    <button
      v-if="!expanded"
      type="button"
      class="dock-fab pointer-events-auto fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full text-sand-50 shadow-xl sm:bottom-6 sm:right-6"
      title="Ask the planner"
      @click="expand"
    >
      <span class="dock-fab-symbol font-display text-2xl italic">✦</span>
    </button>
  </Transition>

  <!-- Expanded bottom sheet -->
  <Transition name="sheet-up">
    <div
      v-if="expanded"
      class="dock-sheet pointer-events-auto fixed inset-x-0 bottom-0 z-[70] flex flex-col gap-4 rounded-t-[28px] px-4 pt-3"
      :style="{
        minHeight: '58vh',
        maxHeight: '92vh',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)',
      }"
    >
      <!-- Drag handle -->
      <div class="mx-auto h-1 w-12 shrink-0 rounded-full bg-sand-400/40" />

      <!-- Letterhead -->
      <header class="mx-auto flex w-full max-w-[28rem] items-baseline justify-between">
        <div class="flex items-baseline gap-2">
          <span class="font-display text-base italic text-terra-500">✦</span>
          <span
            class="text-[10px] uppercase tracking-[0.22em] text-sand-500 dark:text-sand-600"
          >
            From your planner
          </span>
        </div>
        <span
          v-if="usageUsed != null && usageLimit != null"
          class="text-[10px] uppercase tracking-[0.18em] tabular-nums"
          :class="
            (usageRemaining ?? 1) <= 10 ? 'font-medium text-terra-500' : 'text-sand-500'
          "
          :title="`${usageUsed}/${usageLimit} AI prompts used this month`"
        >
          {{ usageUsed }} / {{ usageLimit }}
        </span>
      </header>
      <div class="mx-auto h-px w-full max-w-[28rem] bg-sand-300/60 dark:bg-sand-300/30" />

      <!-- Input pill -->
      <div class="mx-auto w-full max-w-[28rem]">
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
            class="flex items-center gap-2 rounded-full bg-sand-900 py-2 pl-3 pr-2"
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

            <!-- Loading dots OR sparkle -->
            <span
              v-if="loading"
              class="flex shrink-0 items-end gap-[3px] pl-1"
              aria-hidden="true"
            >
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
              <span class="dock-dot block h-1.5 w-1.5 rounded-full bg-terra-400" />
            </span>
            <span
              v-else
              class="font-display text-base italic leading-none text-terra-400"
              aria-hidden="true"
            >
              ✦
            </span>

            <input
              ref="inputEl"
              :value="modelValue"
              type="text"
              :disabled="loading || limitReached"
              :placeholder="placeholder"
              class="min-w-0 flex-1 border-none bg-transparent text-sm text-sand-50 placeholder:italic placeholder:text-sand-50/70 focus:outline-none disabled:opacity-70"
              @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
              @focus="focused = true"
              @blur="focused = false"
              @keydown.enter.prevent="handleSubmit"
            />
            <button
              type="button"
              :disabled="!loading && (!modelValue.trim() || limitReached)"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40"
              :class="loading ? 'bg-sand-600 hover:bg-sand-500' : 'bg-terra-500 hover:bg-terra-600'"
              :title="loading ? 'Cancel' : 'Send'"
              @click="handleClick"
            >
              <Icon :name="loading ? 'lucide:x' : 'lucide:arrow-up'" class="h-4 w-4" />
            </button>
          </div>
        </BorderBeam>
      </div>

      <!-- Body scrollable area -->
      <div class="dock-scroll mx-auto w-full max-w-[28rem] flex-1 overflow-y-auto pb-4">
        <!-- Response (curator's note + cards) -->
        <Transition name="ink-rise">
          <div v-if="response" class="flex flex-col gap-4">
            <!-- Curator's note -->
            <div class="dock-note relative pr-9">
              <button
                type="button"
                class="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
                title="Close"
                @click="emit('closeResponse')"
              >
                <Icon name="lucide:x" class="h-4 w-4" />
              </button>
              <p
                class="font-display text-[17px] italic leading-snug text-sand-900 dark:text-sand-900"
              >
                <span class="mr-1 text-terra-500">“</span>{{ response.message
                }}<span class="ml-0.5 text-terra-500">”</span>
              </p>
              <p class="mt-2 text-[10px] uppercase tracking-[0.22em] text-sand-500">
                — Planner
              </p>
            </div>

            <!-- Findings (review intent) -->
            <ul
              v-if="groupedFindings.length"
              class="dock-stack flex list-none flex-col gap-2.5 p-0"
            >
              <li
                v-for="(group, i) in groupedFindings"
                :key="group.id"
                class="dock-card-enter group relative overflow-hidden rounded-2xl border border-sand-300/70 bg-white pl-3 pr-3 pt-3 pb-2.5 shadow-[0_1px_0_0_rgba(61,51,40,0.04),0_8px_24px_-12px_rgba(61,51,40,0.18)] dark:border-sand-300/30 dark:bg-sand-100"
                :style="{ animationDelay: `${i * 60}ms` }"
              >
                <!-- Severity ribbon -->
                <span
                  class="absolute inset-y-0 left-0 w-[3px]"
                  :class="severityMeta[group.severity].ribbon"
                  aria-hidden="true"
                />
                <div class="flex items-start justify-between gap-3 pl-2">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-sand-700 dark:text-sand-700"
                      >
                        <span
                          class="h-1 w-1 rounded-full"
                          :class="severityMeta[group.severity].dot"
                        />
                        {{ severityMeta[group.severity].label }}
                      </span>
                      <span class="text-[10px] uppercase tracking-[0.18em] text-sand-500">
                        Day {{ group.dayNumber }}
                      </span>
                      <span
                        v-if="group.count > 1"
                        class="text-[10px] uppercase tracking-[0.18em] text-sand-500"
                      >
                        · ×{{ group.count }}
                      </span>
                    </div>
                    <h4
                      class="mt-1 font-display text-[16px] leading-tight text-sand-900 dark:text-sand-900"
                    >
                      {{ group.title }}
                    </h4>
                    <p class="mt-1.5 text-[12.5px] leading-snug text-sand-700 dark:text-sand-700">
                      {{ group.recommendation }}
                    </p>
                  </div>
                </div>

                <div
                  v-if="group.proposal"
                  class="mt-2.5 flex justify-end pl-2"
                >
                  <button
                    v-if="isApplied(group.proposal.id)"
                    type="button"
                    class="dock-applied"
                    disabled
                  >
                    <span class="dock-applied-stamp">Applied</span>
                  </button>
                  <button
                    v-else
                    type="button"
                    :disabled="isApplying(group.proposal.id)"
                    class="dock-apply"
                    @click="onApply(group.proposal)"
                  >
                    <span class="dock-apply-symbol">✦</span>
                    <span>{{ isApplying(group.proposal.id) ? "Applying" : "Apply fix" }}</span>
                  </button>
                </div>
              </li>
            </ul>

            <!-- Proposal cards (mutation intents) -->
            <ul
              v-if="response.proposals?.length"
              class="dock-stack flex list-none flex-col gap-2.5 p-0"
            >
              <li
                v-for="(proposal, i) in response.proposals"
                :key="proposal.id"
                class="dock-card-enter group relative overflow-hidden rounded-2xl border border-sand-300/70 bg-white shadow-[0_1px_0_0_rgba(61,51,40,0.04),0_8px_24px_-12px_rgba(61,51,40,0.18)] dark:border-sand-300/30 dark:bg-sand-100"
                :style="{ animationDelay: `${i * 60}ms` }"
              >
                <!-- Kind header strip -->
                <div
                  class="flex items-center justify-between border-b border-dashed border-sand-300/60 px-3.5 py-1.5 dark:border-sand-300/20"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="dock-stamp"
                      :data-tone="kindMeta(proposal.kind).tone"
                      aria-hidden="true"
                    >
                      {{ kindMeta(proposal.kind).symbol }}
                    </span>
                    <span
                      class="text-[10px] uppercase tracking-[0.22em] text-sand-700 dark:text-sand-700"
                    >
                      {{ kindMeta(proposal.kind).label }}
                    </span>
                  </div>
                  <span
                    class="text-[10px] uppercase tracking-[0.18em] text-sand-400 dark:text-sand-500"
                  >
                    Proposal
                  </span>
                </div>

                <!-- Body -->
                <div class="px-3.5 pb-3 pt-2.5">
                  <h4
                    class="font-display text-[18px] leading-snug text-sand-900 dark:text-sand-900"
                  >
                    {{ proposal.summary }}
                  </h4>
                  <div class="mt-3 flex items-center justify-end gap-3">
                    <template v-if="isApplied(proposal.id)">
                      <span class="dock-applied-stamp inline-flex">Applied</span>
                    </template>
                    <template v-else>
                      <button
                        type="button"
                        class="dock-dismiss"
                        @click="emit('dismissProposal', proposal.id)"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        :disabled="isApplying(proposal.id)"
                        class="dock-apply"
                        @click="onApply(proposal)"
                      >
                        <span class="dock-apply-symbol">✦</span>
                        <span>{{ isApplying(proposal.id) ? "Applying" : "Apply" }}</span>
                      </button>
                    </template>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </Transition>

        <!-- Feedback toast / suggestion chips -->
        <Transition
          mode="out-in"
          enter-active-class="duration-200 ease-out"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="duration-150 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div v-if="feedbackVisible && (feedbackMessage || feedbackError)" class="mt-2 w-full">
            <div
              v-if="feedbackError"
              class="flex items-start gap-2 rounded-xl border border-terra-200 bg-terra-50 px-3 py-2 text-sm text-terra-700"
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
              class="flex items-center gap-2 rounded-xl border border-forest-100 bg-forest-50 px-3 py-2 text-sm text-forest-700"
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

          <!-- Suggestion chips -->
          <div v-else-if="showSuggestions" class="mt-2 flex flex-col gap-2">
            <p
              class="font-display text-sm italic text-sand-500 dark:text-sand-600"
            >
              A few thoughts to begin with…
            </p>
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                :disabled="loading"
                class="dock-chip dock-chip-primary"
                @mousedown.prevent
                @click="emit('generateFull')"
              >
                <span class="dock-chip-symbol">✦</span>
                Generate full itinerary
              </button>
              <button
                v-for="s in suggestions"
                :key="s"
                type="button"
                class="dock-chip"
                @mousedown.prevent
                @click="selectSuggestion(s)"
              >
                {{ s }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── Bottom sheet: cream paper with subtle grain ─────────────────── */
.dock-sheet {
  background: var(--color-sand-50);
  box-shadow:
    0 -1px 0 0 var(--color-sand-300) inset,
    0 -28px 60px -20px rgba(61, 51, 40, 0.35);
  position: fixed;
}
.dock-sheet::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  z-index: 0;
}
.dock-sheet > * {
  position: relative;
  z-index: 1;
}

/* ── FAB: wax-seal-style circle ─────────────────────────────────── */
.dock-fab {
  background: radial-gradient(
    circle at 32% 28%,
    var(--color-terra-400) 0%,
    var(--color-terra-500) 45%,
    var(--color-terra-700) 100%
  );
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.22) inset,
    0 10px 24px -6px rgba(180, 60, 30, 0.55),
    0 2px 4px 0 rgba(0, 0, 0, 0.15);
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.2s ease;
}
.dock-fab:hover {
  transform: translateY(-2px) rotate(-3deg);
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.22) inset,
    0 16px 28px -8px rgba(180, 60, 30, 0.6),
    0 3px 6px 0 rgba(0, 0, 0, 0.18);
}
.dock-fab:active {
  transform: translateY(0) scale(0.97);
}
.dock-fab-symbol {
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
  transform: translateY(-1px);
}

/* ── Input pill ──────────────────────────────────────────────────── */
.dock-beam {
  border-radius: 9999px;
}

/* ── Curator's note ──────────────────────────────────────────────── */
.dock-note {
  border-left: 2px solid var(--color-terra-300);
  padding: 0 0 0 14px;
  margin: 4px 0 0 4px;
}

/* ── Cards: paper with stamp tags ───────────────────────────────── */
.dock-stack {
  margin: 0;
}

.dock-card-enter {
  animation: cardRise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes cardRise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Kind stamp: a small monogram on the proposal card */
.dock-stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  width: 18px;
  border-radius: 4px;
  font-family: var(--font-display);
  font-style: italic;
  font-size: 13px;
  line-height: 1;
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-300);
  color: var(--color-sand-800);
  transform: rotate(-3deg);
}
.dock-stamp[data-tone="terra"] {
  background: var(--color-terra-50);
  border-color: var(--color-terra-200);
  color: var(--color-terra-700);
}
.dock-stamp[data-tone="ocean"] {
  background: var(--color-ocean-50);
  border-color: var(--color-ocean-200);
  color: var(--color-ocean-700);
}
.dock-stamp[data-tone="forest"] {
  background: var(--color-forest-50);
  border-color: var(--color-forest-200);
  color: var(--color-forest-700);
}

/* ── Buttons: Apply (filled), Dismiss (link), Applied (stamp) ──── */
/* Sized for comfortable touch targets on mobile (≥44px tap zone via height + padding). */
.dock-apply {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  color: white;
  background: linear-gradient(180deg, var(--color-terra-500) 0%, var(--color-terra-600) 100%);
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.18),
    0 1px 2px 0 rgba(180, 60, 30, 0.3),
    0 0 0 0 rgba(180, 60, 30, 0);
  transition:
    box-shadow 0.18s ease,
    transform 0.12s ease,
    background 0.18s ease;
  touch-action: manipulation;
}
.dock-apply:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--color-terra-400) 0%, var(--color-terra-500) 100%);
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.25),
    0 4px 10px -2px rgba(180, 60, 30, 0.45),
    0 0 0 3px rgba(240, 123, 90, 0.12);
}
.dock-apply:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow:
    inset 0 1px 2px 0 rgba(0, 0, 0, 0.18),
    0 0 0 3px rgba(240, 123, 90, 0.1);
}
.dock-apply:disabled {
  opacity: 0.6;
  cursor: progress;
}
.dock-apply-symbol {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 13px;
  line-height: 1;
  transform: translateY(-1px);
}

.dock-dismiss {
  font-size: 13px;
  color: var(--color-sand-600);
  min-height: 36px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  transition: color 0.15s ease;
  touch-action: manipulation;
}
.dock-dismiss:hover {
  color: var(--color-sand-900);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--color-sand-500);
}

.dock-applied {
  display: inline-flex;
  align-items: center;
}
.dock-applied-stamp {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1.5px solid var(--color-forest-500);
  border-radius: 6px;
  color: var(--color-forest-700);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 14px;
  letter-spacing: 0.04em;
  background: var(--color-forest-50);
  transform: rotate(-4deg);
  box-shadow: 0 1px 0 0 rgba(0, 0, 0, 0.02);
}

/* ── Suggestion chips ───────────────────────────────────────────── */
.dock-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 9px;
  min-height: 34px;
  font-size: 13px;
  color: var(--color-sand-800);
  background: var(--color-sand-100);
  border: 1px solid var(--color-sand-300);
  border-bottom-width: 2px;
  border-radius: 999px;
  transition:
    transform 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
  font-family: var(--font-sans);
  touch-action: manipulation;
}
.dock-chip:hover {
  background: var(--color-terra-50);
  border-color: var(--color-terra-300);
  color: var(--color-terra-700);
  transform: translateY(-1px);
}
.dock-chip-primary {
  background: var(--color-sand-900);
  color: var(--color-sand-50);
  border-color: var(--color-sand-900);
}
.dock-chip-primary:hover {
  background: var(--color-terra-600);
  border-color: var(--color-terra-700);
  color: white;
}
.dock-chip-symbol {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 13px;
  color: var(--color-terra-400);
  transform: translateY(-1px);
}
.dock-chip-primary .dock-chip-symbol {
  color: var(--color-sand-50);
}

/* ── Loading dots ───────────────────────────────────────────────── */
.dock-dot {
  animation: dotPulse 1.4s ease-in-out infinite;
}
.dock-dot:nth-child(2) {
  animation-delay: 0.16s;
}
.dock-dot:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes dotPulse {
  0%,
  60%,
  100% {
    transform: scale(0.7);
    opacity: 0.55;
  }
  30% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ── Scroll area ────────────────────────────────────────────────── */
.dock-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--color-sand-300) transparent;
}
.dock-scroll::-webkit-scrollbar {
  width: 4px;
}
.dock-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.dock-scroll::-webkit-scrollbar-thumb {
  background: var(--color-sand-300);
  border-radius: 9999px;
}

/* ── Transitions ────────────────────────────────────────────────── */
.fab-pop-enter-active,
.fab-pop-leave-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.26s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: bottom right;
  will-change: transform, opacity;
}
.fab-pop-enter-from,
.fab-pop-leave-to {
  opacity: 0;
  transform: scale(0.6) rotate(-12deg);
}
.fab-pop-enter-to,
.fab-pop-leave-from {
  opacity: 1;
  transform: scale(1) rotate(0deg);
}

.sheet-up-enter-active {
  transition:
    transform 0.32s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.22s ease-out;
}
.sheet-up-leave-active {
  transition:
    transform 0.22s ease-in,
    opacity 0.15s ease-in;
}
.sheet-up-enter-from,
.sheet-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
.sheet-up-enter-to,
.sheet-up-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.ink-rise-enter-active {
  transition:
    opacity 0.32s ease-out,
    transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.ink-rise-leave-active {
  transition:
    opacity 0.18s ease-in,
    transform 0.18s ease-in;
}
.ink-rise-enter-from,
.ink-rise-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.ink-rise-enter-to,
.ink-rise-leave-from {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .fab-pop-enter-active,
  .fab-pop-leave-active,
  .sheet-up-enter-active,
  .sheet-up-leave-active,
  .ink-rise-enter-active,
  .ink-rise-leave-active,
  .dock-card-enter {
    transition: opacity 0.15s ease-out;
    animation: none;
  }
  .fab-pop-enter-from,
  .fab-pop-leave-to,
  .sheet-up-enter-from,
  .sheet-up-leave-to,
  .ink-rise-enter-from,
  .ink-rise-leave-to {
    transform: none;
  }
  .dock-dot {
    animation: none;
  }
}
</style>
