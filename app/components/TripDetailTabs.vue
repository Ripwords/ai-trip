<script setup lang="ts">
defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const primaryTabs = [
  { value: "itinerary", label: "Itinerary" },
  { value: "overview", label: "Overview" },
  { value: "review", label: "Review" },
  { value: "expenses", label: "Expenses" },
  { value: "reservations", label: "Bookings" },
] as const

const overflowTabs = [
  { value: "notes", label: "Notes" },
  { value: "team", label: "Team" },
  { value: "flights", label: "Flights" },
] as const

const overflowOpen = ref(false)

function pick(value: string) {
  emit("update:modelValue", value)
  overflowOpen.value = false
}

function onDocumentClick(e: MouseEvent) {
  if (overflowOpen.value && !(e.target as HTMLElement).closest("[data-tabs-more]")) {
    overflowOpen.value = false
  }
}

onMounted(() => {
  if (import.meta.client) document.addEventListener("click", onDocumentClick)
})
onUnmounted(() => {
  if (import.meta.client) document.removeEventListener("click", onDocumentClick)
})
</script>

<template>
  <div role="tablist" class="flex items-end gap-x-4 border-b border-sand-200 sm:gap-x-6">
    <!-- The scroller clips the last label mid-word at 390px. Fade the trailing
         edge so that reads as "there is more, swipe" rather than as a bug. -->
    <div class="tab-scroller min-w-0 flex-1 overflow-x-auto scrollbar-hide">
      <div class="flex items-end gap-x-4 pb-px sm:gap-x-6">
        <button
          v-for="tab in primaryTabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="modelValue === tab.value"
          class="relative inline-flex min-h-11 shrink-0 items-center rounded-sm text-sm transition focus-ring"
          :class="
            modelValue === tab.value
              ? 'font-medium text-sand-900'
              : 'text-sand-700 hover:text-sand-900'
          "
          @click="pick(tab.value)"
        >
          {{ tab.label }}
          <span
            v-if="modelValue === tab.value"
            class="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-terra-500"
          />
        </button>
      </div>
    </div>

    <div data-tabs-more class="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        :aria-expanded="overflowOpen"
        aria-label="More tabs"
        class="relative inline-flex min-h-11 items-center gap-1 rounded-sm text-sm transition focus-ring"
        :class="
          overflowTabs.some((t) => t.value === modelValue)
            ? 'font-medium text-sand-900'
            : 'text-sand-700 hover:text-sand-900'
        "
        @click.stop="overflowOpen = !overflowOpen"
      >
        More
        <Icon name="lucide:chevron-down" class="h-3 w-3" />
        <span
          v-if="overflowTabs.some((t) => t.value === modelValue)"
          class="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-terra-500"
        />
      </button>
      <Transition
        enter-active-class="duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="duration-100 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="overflowOpen"
          class="absolute right-0 top-full z-30 mt-1 w-40 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
        >
          <button
            v-for="tab in overflowTabs"
            :key="tab.value"
            type="button"
            role="tab"
            :aria-selected="modelValue === tab.value"
            class="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm transition hover:bg-sand-50 focus-ring"
            :class="modelValue === tab.value ? 'font-medium text-sand-900' : 'text-sand-700'"
            @click.stop="pick(tab.value)"
          >
            {{ tab.label }}
            <Icon
              v-if="modelValue === tab.value"
              name="lucide:check"
              class="h-3.5 w-3.5 text-terra-500"
            />
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* Only fade once the row actually overflows: `scroll-state` keeps the mask off
   at desktop widths where every tab fits. Falls back to no mask where the query
   is unsupported, which is the current (unfaded) behaviour. */
.tab-scroller {
  scroll-snap-type: x proximity;
  container-type: scroll-state;
}
.tab-scroller > * > * {
  scroll-snap-align: start;
}
@container scroll-state(scrollable: right) {
  .tab-scroller {
    mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
  }
}
</style>
