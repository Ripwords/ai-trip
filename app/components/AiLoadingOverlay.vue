<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
  mode: "generate" | "optimize";
}>();

const steps = computed(() =>
  props.mode === "generate"
    ? [
        { icon: "lucide:search", text: "Searching travel blogs & local guides..." },
        { icon: "lucide:sparkles", text: "Finding hidden gems & local favorites..." },
        { icon: "lucide:map-pin", text: "Validating places on Google Maps..." },
        { icon: "lucide:calendar-check", text: "Building your itinerary..." },
      ]
    : [
        { icon: "lucide:search", text: "Researching routes & transit options..." },
        { icon: "lucide:route", text: "Calculating optimal order..." },
        { icon: "lucide:clock", text: "Assigning realistic times..." },
      ]
);

const activeStep = ref(0);
let interval: ReturnType<typeof setInterval> | null = null;

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      activeStep.value = 0;
      interval = setInterval(() => {
        activeStep.value = (activeStep.value + 1) % steps.value.length;
      }, 3000);
    } else {
      if (interval) clearInterval(interval);
      interval = null;
    }
  }
);

onUnmounted(() => {
  if (interval) clearInterval(interval);
});
</script>

<template>
  <Transition
    enter-active-class="duration-300 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="duration-200 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="visible"
      class="relative overflow-hidden rounded-2xl border border-sand-200/60 bg-gradient-to-br from-white via-sand-50 to-terra-50/30 p-10"
    >
      <!-- Ambient glow -->
      <div class="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-terra-200/30 blur-[60px]" aria-hidden="true" />
      <div class="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-ocean-200/20 blur-[50px]" aria-hidden="true" />

      <div class="relative z-10 flex flex-col items-center text-center">
        <!-- Orbiting ring -->
        <div class="relative h-20 w-20">
          <div class="absolute inset-0 animate-spin rounded-full border-2 border-terra-200 border-t-terra-500" style="animation-duration: 3s" />
          <div class="absolute inset-2 animate-spin rounded-full border-2 border-ocean-100 border-b-ocean-400" style="animation-duration: 5s; animation-direction: reverse" />
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-terra-500 shadow-lg shadow-terra-500/30">
              <Transition
                mode="out-in"
                enter-active-class="duration-200 ease-out"
                enter-from-class="opacity-0 scale-75"
                enter-to-class="opacity-100 scale-100"
                leave-active-class="duration-150 ease-in"
                leave-from-class="opacity-100 scale-100"
                leave-to-class="opacity-0 scale-75"
              >
                <Icon
                  :key="activeStep"
                  :name="steps[activeStep].icon"
                  class="h-5 w-5 text-white"
                />
              </Transition>
            </div>
          </div>
        </div>

        <!-- Step text -->
        <Transition
          mode="out-in"
          enter-active-class="duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="duration-200 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 -translate-y-2"
        >
          <p :key="activeStep" class="mt-6 text-sm font-medium text-sand-800">
            {{ steps[activeStep].text }}
          </p>
        </Transition>

        <!-- Progress dots -->
        <div class="mt-5 flex gap-2">
          <div
            v-for="(_, i) in steps"
            :key="i"
            class="h-1.5 rounded-full transition-all duration-500"
            :class="i === activeStep ? 'w-8 bg-terra-500' : i < activeStep ? 'w-1.5 bg-terra-300' : 'w-1.5 bg-sand-200'"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>
