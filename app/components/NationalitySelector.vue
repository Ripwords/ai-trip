<script setup lang="ts">
import { countries, countryByAlpha2 } from "../data/countries";

const props = defineProps<{
  modelValue: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

const searchQuery = ref("");
const isOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const selectedName = computed(() => {
  if (!props.modelValue) return null;
  return countryByAlpha2.get(props.modelValue)?.name ?? props.modelValue;
});

const filteredCountries = computed(() => {
  if (!searchQuery.value) return countries;
  const q = searchQuery.value.toLowerCase();
  return countries.filter(
    (c) => c.name.toLowerCase().includes(q) || c.alpha2.toLowerCase().includes(q)
  );
});

function select(alpha2: string) {
  emit("update:modelValue", alpha2);
  isOpen.value = false;
  searchQuery.value = "";
}

function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", handleClickOutside));
onUnmounted(() => document.removeEventListener("click", handleClickOutside));
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <button
      class="flex w-full items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-2.5 text-left text-sm transition hover:border-sand-300 dark:border-sand-700 dark:bg-sand-800 dark:hover:border-sand-600"
      @click.stop="isOpen = !isOpen"
    >
      <span :class="selectedName ? 'text-sand-900 dark:text-sand-100' : 'text-sand-400'">
        {{ selectedName ?? 'Select your passport nationality' }}
      </span>
      <Icon
        name="lucide:chevron-down"
        class="h-4 w-4 text-sand-400 transition-transform"
        :class="{ 'rotate-180': isOpen }"
      />
    </button>

    <Transition
      enter-active-class="duration-150 ease-out"
      enter-from-class="scale-95 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="duration-100 ease-in"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-95 opacity-0"
    >
      <div
        v-if="isOpen"
        class="absolute z-20 mt-1 w-full origin-top rounded-xl border border-sand-200 bg-white shadow-lg dark:border-sand-700 dark:bg-sand-800"
      >
        <div class="border-b border-sand-100 p-2 dark:border-sand-700">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search countries..."
            class="w-full rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder-sand-400 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-900 dark:text-sand-100"
          />
        </div>
        <ul class="max-h-60 overflow-y-auto py-1">
          <li
            v-for="c in filteredCountries"
            :key="c.alpha2"
            class="cursor-pointer px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-50 dark:text-sand-300 dark:hover:bg-sand-700"
            :class="{ 'bg-terra-50 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300': c.alpha2 === modelValue }"
            @click="select(c.alpha2)"
          >
            {{ c.name }}
            <span class="ml-1 text-xs text-sand-400">{{ c.alpha2 }}</span>
          </li>
          <li v-if="!filteredCountries.length" class="px-4 py-3 text-center text-sm text-sand-400">
            No countries found
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
