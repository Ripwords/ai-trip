<script setup lang="ts">
const props = defineProps<{
  visible: boolean
  mode: "generate" | "optimize" | "remove" | "reschedule"
}>()

const stepSets: Record<string, { icon: string; text: string; detail: string }[]> = {
  generate: [
    { icon: "lucide:search", text: "Searching travel blogs & local guides", detail: "Web search" },
    { icon: "lucide:sparkles", text: "Finding hidden gems & local favorites", detail: "Discovery" },
    { icon: "lucide:map-pin", text: "Validating places on Google Maps", detail: "Verification" },
    { icon: "lucide:calendar-check", text: "Building your itinerary", detail: "Assembly" },
  ],
  optimize: [
    { icon: "lucide:search", text: "Researching routes & transit options", detail: "Analysis" },
    { icon: "lucide:route", text: "Calculating optimal order", detail: "Optimization" },
    { icon: "lucide:clock", text: "Assigning realistic times", detail: "Scheduling" },
  ],
  remove: [
    { icon: "lucide:scan-search", text: "Identifying activities to remove", detail: "Matching" },
    { icon: "lucide:check", text: "Updating your itinerary", detail: "Cleanup" },
  ],
  reschedule: [
    { icon: "lucide:clock", text: "Analyzing your current schedule", detail: "Review" },
    { icon: "lucide:calendar-clock", text: "Adjusting times and order", detail: "Rescheduling" },
  ],
}

const steps = computed(() => stepSets[props.mode] ?? stepSets.generate)

const activeStep = ref(0)
const activeStepData = computed(() => steps.value![activeStep.value]!)
let interval: ReturnType<typeof setInterval> | null = null

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      activeStep.value = 0
      interval = setInterval(() => {
        activeStep.value = (activeStep.value + 1) % steps.value!.length
      }, 3000)
    } else {
      if (interval) clearInterval(interval)
      interval = null
    }
  },
)

onUnmounted(() => {
  if (interval) clearInterval(interval)
})
</script>

<template>
  <Transition
    enter-active-class="duration-500 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="duration-300 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible"
      class="loading-overlay relative overflow-hidden rounded-2xl border border-sand-200/40 bg-sand-50 px-6 py-12 sm:py-16"
    >
      <!-- Topographic contour lines — animated SVG background -->
      <svg
        class="contour-lines pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M-20,160 Q60,100 120,140 T260,120 T400,150"
          stroke="var(--color-sand-200)"
          stroke-width="0.8"
          class="contour contour-1"
        />
        <path
          d="M-20,180 Q80,130 150,165 T280,145 T420,170"
          stroke="var(--color-terra-200)"
          stroke-width="0.6"
          class="contour contour-2"
          opacity="0.7"
        />
        <path
          d="M-20,200 Q100,160 180,190 T300,170 T420,195"
          stroke="var(--color-sand-300)"
          stroke-width="0.5"
          class="contour contour-3"
          opacity="0.5"
        />
        <path
          d="M-20,140 Q50,80 130,115 T270,95 T420,130"
          stroke="var(--color-ocean-200)"
          stroke-width="0.5"
          class="contour contour-4"
          opacity="0.4"
        />
        <path
          d="M-20,220 Q90,190 160,215 T310,195 T420,215"
          stroke="var(--color-sand-200)"
          stroke-width="0.4"
          class="contour contour-5"
          opacity="0.3"
        />
      </svg>

      <!-- Subtle grain texture -->
      <div class="grain pointer-events-none absolute inset-0" aria-hidden="true" />

      <!-- Content -->
      <div class="relative z-10 flex flex-col items-center">
        <!-- Compass rose / pin marker -->
        <div class="relative mb-8">
          <div
            class="compass-ring flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm shadow-sand-300/50 ring-1 ring-sand-200/60"
          >
            <Transition
              mode="out-in"
              enter-active-class="duration-300 ease-out"
              enter-from-class="opacity-0 -translate-y-1"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="duration-200 ease-in"
              leave-from-class="opacity-100 translate-y-0"
              leave-to-class="opacity-0 translate-y-1"
            >
              <Icon :key="activeStep" :name="activeStepData.icon" class="h-6 w-6 text-terra-500" />
            </Transition>
          </div>
          <!-- Pulse ring -->
          <div class="pulse-ring absolute -inset-2 rounded-[20px] border border-terra-300/40" />
        </div>

        <!-- Step label -->
        <Transition
          mode="out-in"
          enter-active-class="duration-400 ease-out"
          enter-from-class="opacity-0 translate-y-1.5"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="duration-200 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div :key="activeStep" class="text-center">
            <span
              class="mb-1.5 block font-display text-[11px] uppercase tracking-[0.2em] text-terra-400"
            >
              {{ activeStepData.detail }}
            </span>
            <p class="text-sm font-medium text-sand-700">
              {{ activeStepData.text }}
            </p>
          </div>
        </Transition>

        <!-- Step indicator — horizontal dashes -->
        <div class="mt-6 flex items-center gap-1.5">
          <div
            v-for="(_, i) in steps"
            :key="i"
            class="h-[3px] rounded-full transition-all duration-700 ease-out"
            :class="
              i === activeStep
                ? 'w-6 bg-terra-500'
                : i < activeStep
                  ? 'w-3 bg-terra-300'
                  : 'w-3 bg-sand-200'
            "
          />
        </div>

        <!-- Step count -->
        <p class="mt-4 text-[11px] tabular-nums text-sand-400">
          {{ activeStep + 1 }} / {{ steps!.length }}
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Contour line drift animation */
.contour {
  stroke-dasharray: 8 6;
}

.contour-1 {
  animation: drift 12s ease-in-out infinite;
}
.contour-2 {
  animation: drift 16s ease-in-out infinite reverse;
}
.contour-3 {
  animation: drift 20s ease-in-out infinite;
  animation-delay: -3s;
}
.contour-4 {
  animation: drift 14s ease-in-out infinite reverse;
  animation-delay: -5s;
}
.contour-5 {
  animation: drift 18s ease-in-out infinite;
  animation-delay: -8s;
}

@keyframes drift {
  0%,
  100% {
    transform: translateX(0) translateY(0);
  }
  25% {
    transform: translateX(8px) translateY(-3px);
  }
  50% {
    transform: translateX(-4px) translateY(5px);
  }
  75% {
    transform: translateX(6px) translateY(2px);
  }
}

/* Pulse ring */
.pulse-ring {
  animation: pulse-expand 2.5s ease-out infinite;
}

@keyframes pulse-expand {
  0% {
    opacity: 0.6;
    transform: scale(1);
  }
  70% {
    opacity: 0;
    transform: scale(1.3);
  }
  100% {
    opacity: 0;
    transform: scale(1.3);
  }
}

/* Compass container subtle breathe */
.compass-ring {
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    box-shadow: 0 1px 3px rgba(61, 51, 40, 0.06);
  }
  50% {
    box-shadow: 0 4px 16px rgba(232, 93, 58, 0.08);
  }
}
</style>
