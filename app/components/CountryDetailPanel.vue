<script setup lang="ts">
import type { CountryInfo } from "../data/countries";

const props = defineProps<{
  country: CountryInfo | null;
  isVisited: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  toggleVisited: [country: CountryInfo];
  checkVisa: [country: CountryInfo];
}>();
</script>

<template>
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="duration-150 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="country"
      class="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-sand-200 bg-white shadow-xl dark:border-sand-700 dark:bg-sand-900"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-sand-200 px-5 py-4 dark:border-sand-700">
        <div>
          <h2 class="font-display text-lg text-sand-900 dark:text-sand-100">
            {{ country.name }}
          </h2>
          <p class="text-sm text-sand-500">{{ country.region }} &middot; {{ country.alpha2 }}</p>
        </div>
        <button
          class="rounded-lg p-2 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 dark:hover:bg-sand-800"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 space-y-4 overflow-y-auto p-5">
        <!-- Visited toggle -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="isVisited
            ? 'border-terra-300 bg-terra-50 text-terra-700 dark:border-terra-600 dark:bg-terra-900/30 dark:text-terra-300'
            : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800'"
          :disabled="loading"
          @click="emit('toggleVisited', country)"
        >
          <Icon
            :name="isVisited ? 'lucide:check-circle-2' : 'lucide:circle'"
            class="h-5 w-5 shrink-0"
          />
          <div>
            <p class="font-medium">{{ isVisited ? 'Visited' : 'Mark as visited' }}</p>
            <p class="text-xs opacity-70">
              {{ isVisited ? 'Click to remove from your scratch map' : 'Add this country to your travel history' }}
            </p>
          </div>
        </button>

        <!-- Visa check button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border border-sand-200 px-4 py-3 text-left text-sand-700 transition hover:border-sand-300 hover:bg-sand-50 dark:border-sand-700 dark:text-sand-300 dark:hover:bg-sand-800"
          @click="emit('checkVisa', country)"
        >
          <Icon name="lucide:shield-check" class="h-5 w-5 shrink-0 text-blue-500" />
          <div>
            <p class="font-medium">Check visa requirements</p>
            <p class="text-xs opacity-70">See if you need a visa to visit</p>
          </div>
        </button>
      </div>
    </div>
  </Transition>
</template>
