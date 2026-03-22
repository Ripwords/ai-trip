<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  mode: "generate" | "optimize";
  dayNumber: number;
  destination: string;
  hasActivities: boolean;
}>();

const emit = defineEmits<{
  submit: [prompt: string];
  close: [];
}>();

const prompt = ref("");

const title = computed(() => {
  if (props.mode === "optimize") return `Optimize Day ${props.dayNumber} Route`;
  return props.hasActivities
    ? `AI Fill Gaps — Day ${props.dayNumber}`
    : `AI Generate — Day ${props.dayNumber}`;
});

const description = computed(() => {
  if (props.mode === "optimize") {
    return "Rearrange activities for the most efficient route. Add any preferences below.";
  }
  return props.hasActivities
    ? "Add activities around your existing plans. Describe what you'd like below."
    : `Tell us what you'd like to do in ${props.destination} on this day.`;
});

const placeholder = computed(() => {
  if (props.mode === "optimize") {
    return "e.g. Start from the hotel, end near the train station, prefer walking...";
  }
  return props.hasActivities
    ? "e.g. Add some local lunch spots and a coffee break in the afternoon..."
    : "e.g. Street food tour in Shibuya, visit local temples, nightlife in Shinjuku...";
});

const submitLabel = computed(() =>
  props.mode === "optimize" ? "Optimize" : "Generate"
);

function handleSubmit() {
  emit("submit", prompt.value.trim());
  prompt.value = "";
}

watch(() => props.open, (open) => {
  if (!open) prompt.value = "";
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div
          class="fixed inset-0 bg-black/40"
          @click="emit('close')"
        />
        <div class="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl mx-4">
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-terra-100">
              <Icon
                :name="mode === 'optimize' ? 'lucide:route' : 'lucide:sparkles'"
                class="h-4 w-4 text-terra-600"
              />
            </div>
            <h2 class="text-lg font-display text-sand-900">{{ title }}</h2>
          </div>

          <p class="mt-2 text-sm text-sand-500">{{ description }}</p>

          <form class="mt-4" @submit.prevent="handleSubmit">
            <textarea
              v-model="prompt"
              rows="3"
              :placeholder="placeholder"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus resize-none"
            />
            <p class="mt-1.5 text-xs text-sand-400">
              Leave empty for default suggestions
            </p>

            <div class="mt-4 flex justify-end gap-3">
              <button
                type="button"
                class="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
                @click="emit('close')"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600"
              >
                {{ submitLabel }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
