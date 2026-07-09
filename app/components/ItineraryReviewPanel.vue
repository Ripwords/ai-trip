<script setup lang="ts">
import type { TripDay } from "~/types/trip"

type ReviewScope = "day" | "trip"
type ReviewSeverity = "critical" | "warning" | "suggestion"

interface ReviewFinding {
  id: string
  code: string
  severity: ReviewSeverity
  title: string
  message: string
  recommendation: string
  dayId: string
  dayNumber: number
  activityIds?: string[]
}

interface ReviewResult {
  scope: ReviewScope
  dayId?: string
  findings: Record<ReviewSeverity, ReviewFinding[]>
  summary: {
    checkedDays: number
    checkedActivities: number
    totalFindings: number
    critical: number
    warning: number
    suggestion: number
  }
}

const props = withDefaults(
  defineProps<{
    tripId: string
    days: TripDay[]
    initialScope?: ReviewScope
    initialDayId?: string
  }>(),
  {
    initialScope: "trip",
    initialDayId: undefined,
  },
)

const emit = defineEmits<{
  "update:scope": [scope: ReviewScope]
  "update:dayId": [dayId: string | undefined]
  reviewed: [result: ReviewResult]
  fix: [finding: ReviewFinding]
}>()

const scope = ref<ReviewScope>(props.initialScope)
const selectedDayId = ref<string | undefined>(props.initialDayId ?? props.days[0]?.id)
const result = ref<ReviewResult | null>(null)
const loading = ref(false)
const error = ref("")

const severityMeta: Record<
  ReviewSeverity,
  { label: string; icon: string; badgeClass: string; iconClass: string }
> = {
  critical: {
    label: "Critical",
    icon: "lucide:circle-alert",
    badgeClass: "bg-red-50 text-red-700",
    iconClass: "text-red-500",
  },
  warning: {
    label: "Warnings",
    icon: "lucide:triangle-alert",
    badgeClass: "bg-terra-50 text-terra-700",
    iconClass: "text-terra-600",
  },
  suggestion: {
    label: "Suggestions",
    icon: "lucide:lightbulb",
    badgeClass: "bg-ocean-50 text-ocean-700",
    iconClass: "text-ocean-500",
  },
}

const severityOrder: ReviewSeverity[] = ["critical", "warning", "suggestion"]

const selectedDay = computed(() => props.days.find((day) => day.id === selectedDayId.value))

const visibleGroups = computed(() => {
  if (!result.value) return []
  return severityOrder
    .map((severity) => ({
      severity,
      meta: severityMeta[severity],
      findings: result.value!.findings[severity],
    }))
    .filter((group) => group.findings.length > 0)
})

watch(scope, (value) => {
  emit("update:scope", value)
  if (value === "day" && !selectedDayId.value) selectedDayId.value = props.days[0]?.id
})

watch(selectedDayId, (value) => {
  emit("update:dayId", value)
})

watch(
  () => props.initialScope,
  (value) => {
    scope.value = value
  },
)

watch(
  () => props.initialDayId,
  (value) => {
    if (value && props.days.some((day) => day.id === value)) {
      selectedDayId.value = value
    }
  },
)

watch(
  () => props.days,
  (days) => {
    if (selectedDayId.value && days.some((day) => day.id === selectedDayId.value)) return
    selectedDayId.value = days[0]?.id
  },
)

watch([scope, selectedDayId], () => {
  if (result.value && !loading.value) void runReview()
})

function fixButtonLabel(code: string): string {
  switch (code) {
    case "missing-start-point":
    case "missing-accommodation-coordinates":
      return "Set accommodation"
    case "missing-lunch":
      return "Add lunch"
    case "missing-dinner":
      return "Add dinner"
    case "missing-activity-coordinates":
    case "missing-activity-time":
    case "missing-activity-duration":
    case "activity-overlap":
    case "long-travel-segment":
    case "late-ending":
      return "Edit activity"
    default:
      return "Fix"
  }
}

async function runReview() {
  if (scope.value === "day" && !selectedDayId.value) {
    error.value = "Choose a day to review."
    return
  }

  loading.value = true
  error.value = ""

  try {
    const review = await $fetch<ReviewResult>(`/api/trips/${props.tripId}/review`, {
      method: "POST",
      body: {
        scope: scope.value,
        dayId: scope.value === "day" ? selectedDayId.value : undefined,
      },
    })
    result.value = review
    emit("reviewed", review)
  } catch (e: unknown) {
    console.error("Failed to review itinerary:", e)
    error.value = "Review failed. Try again in a moment."
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  runReview()
})
</script>

<template>
  <section class="rounded-2xl border border-sand-200 bg-white p-5 sm:p-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="flex items-center gap-2">
          <Icon name="lucide:sparkles" class="h-4 w-4 text-terra-500" />
          <h2 class="text-base font-semibold text-sand-900">Itinerary Review</h2>
        </div>
        <p class="mt-1 text-sm text-sand-500">
          Checks timing, routing, meals, and missing planning details.
        </p>
      </div>

      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-terra-500 px-3 text-sm font-medium text-white transition hover:bg-terra-600 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading"
        @click="runReview"
      >
        <Icon name="lucide:refresh-cw" class="h-4 w-4" :class="{ 'animate-spin': loading }" />
        {{ loading ? "Reviewing" : "Review" }}
      </button>
    </div>

    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="inline-flex w-fit rounded-lg border border-sand-200 bg-sand-50 p-1">
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm transition"
          :class="
            scope === 'trip' ? 'bg-white font-medium text-sand-900 shadow-sm' : 'text-sand-500'
          "
          @click="scope = 'trip'"
        >
          Trip
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm transition"
          :class="
            scope === 'day' ? 'bg-white font-medium text-sand-900 shadow-sm' : 'text-sand-500'
          "
          @click="scope = 'day'"
        >
          Day
        </button>
      </div>

      <select
        v-if="scope === 'day'"
        v-model="selectedDayId"
        aria-label="Day to review"
        class="h-9 rounded-lg border border-sand-300 bg-white px-3 text-sm text-sand-700 input-focus"
      >
        <option v-for="day in days" :key="day.id" :value="day.id">
          Day {{ day.dayNumber }} - {{ day.date }}
        </option>
      </select>
    </div>

    <div
      v-if="error"
      role="alert"
      class="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <div v-else-if="result" class="mt-5 space-y-5" :aria-busy="loading ? 'true' : 'false'">
      <div class="grid gap-2 sm:grid-cols-4">
        <div class="rounded-lg bg-sand-50 px-3 py-2">
          <div class="text-xs text-sand-500">Findings</div>
          <div class="text-lg font-semibold text-sand-900">{{ result.summary.totalFindings }}</div>
        </div>
        <div class="rounded-lg bg-sand-50 px-3 py-2">
          <div class="text-xs text-sand-500">Days</div>
          <div class="text-lg font-semibold text-sand-900">{{ result.summary.checkedDays }}</div>
        </div>
        <div class="rounded-lg bg-sand-50 px-3 py-2">
          <div class="text-xs text-sand-500">Activities</div>
          <div class="text-lg font-semibold text-sand-900">
            {{ result.summary.checkedActivities }}
          </div>
        </div>
        <div class="rounded-lg bg-sand-50 px-3 py-2">
          <div class="text-xs text-sand-500">Scope</div>
          <div class="truncate text-sm font-medium text-sand-900">
            {{
              result.scope === "trip"
                ? "Whole trip"
                : selectedDay
                  ? `Day ${selectedDay.dayNumber}`
                  : "Day"
            }}
          </div>
        </div>
      </div>

      <div
        v-if="result.summary.totalFindings === 0"
        class="rounded-xl border border-forest-100 bg-forest-50 p-4"
      >
        <div class="flex items-start gap-3">
          <Icon name="lucide:check-circle-2" class="mt-0.5 h-5 w-5 text-forest-600" />
          <div>
            <h3 class="text-sm font-semibold text-forest-700">No issues found</h3>
            <p class="mt-1 text-sm text-forest-700/80">
              The selected itinerary has enough timing and location detail for this deterministic
              check.
            </p>
          </div>
        </div>
      </div>

      <div v-for="group in visibleGroups" :key="group.severity" class="space-y-2">
        <div class="flex items-center gap-2">
          <Icon :name="group.meta.icon" class="h-4 w-4" :class="group.meta.iconClass" />
          <h3 class="text-sm font-semibold text-sand-800">{{ group.meta.label }}</h3>
          <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="group.meta.badgeClass">
            {{ group.findings.length }}
          </span>
        </div>

        <article
          v-for="finding in group.findings"
          :key="finding.id"
          class="rounded-xl border border-sand-200 p-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h4 class="text-sm font-semibold text-sand-900">{{ finding.title }}</h4>
              <p class="mt-1 text-sm text-sand-600">{{ finding.message }}</p>
            </div>
            <span class="shrink-0 rounded-full bg-sand-100 px-2 py-0.5 text-xs text-sand-600">
              Day {{ finding.dayNumber }}
            </span>
          </div>
          <p class="mt-3 text-sm text-sand-700">
            <span class="font-medium">Recommendation:</span>
            {{ finding.recommendation }}
          </p>
          <div class="mt-3 flex justify-end">
            <button
              type="button"
              class="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-xs font-medium text-sand-700 transition hover:border-terra-300 hover:bg-terra-50 hover:text-terra-700"
              @click="emit('fix', finding)"
            >
              <Icon name="lucide:wrench" class="h-3.5 w-3.5" />
              {{ fixButtonLabel(finding.code) }}
            </button>
          </div>
        </article>
      </div>
    </div>

    <div v-else class="mt-5 space-y-2">
      <div class="h-20 animate-pulse rounded-xl bg-sand-100" />
      <div class="h-20 animate-pulse rounded-xl bg-sand-100" />
    </div>
  </section>
</template>
