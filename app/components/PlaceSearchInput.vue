<script setup lang="ts">
import type { PlaceResult } from "~/composables/usePlaceSearch"

defineProps<{
  placeholder?: string
}>()

const emit = defineEmits<{
  select: [place: PlaceResult]
}>()

const { query, results, isSearching } = usePlaceSearch()
const showDropdown = ref(false)
const wrapper = ref<HTMLElement | null>(null)

function handleSelect(place: PlaceResult) {
  emit("select", place)
  query.value = ""
  results.value = []
  showDropdown.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (wrapper.value && !wrapper.value.contains(e.target as Node)) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside)
})

watch(results, (val) => {
  if (val.length > 0) showDropdown.value = true
})
</script>

<template>
  <div ref="wrapper" class="relative">
    <div class="relative">
      <Icon
        name="lucide:search"
        class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400 peer-focus:text-terra-500"
      />
      <input
        v-model="query"
        type="text"
        :placeholder="placeholder || 'Search for a place...'"
        class="peer block w-full rounded-lg border border-sand-300 py-2 pl-9 pr-3 text-sm input-focus"
        @focus="showDropdown = results.length > 0"
      />
      <Icon
        v-if="isSearching"
        name="lucide:loader"
        class="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sand-400"
      />
    </div>

    <div
      v-if="showDropdown && results.length > 0"
      class="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-sand-200 bg-white shadow-xl"
    >
      <button
        v-for="place in results"
        :key="place.placeId"
        type="button"
        class="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-sand-100"
        @click="handleSelect(place)"
      >
        <Icon name="lucide:map-pin" class="mt-0.5 h-4 w-4 shrink-0 text-sand-400" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-sand-900 truncate">{{ place.name }}</p>
          <p v-if="place.formattedAddress" class="text-xs text-sand-500 truncate">
            {{ place.formattedAddress }}
          </p>
        </div>
      </button>
    </div>
  </div>
</template>
