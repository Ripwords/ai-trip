<script setup lang="ts">
import { countries, countryByAlpha2, countryFlag } from "../data/countries"

const props = defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string | null]
}>()

const searchQuery = ref("")
const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const listboxId = useId()
const optionId = (index: number) => `${listboxId}-opt-${index}`

const selectedName = computed(() => {
  if (!props.modelValue) return null
  return countryByAlpha2.get(props.modelValue)?.name ?? props.modelValue
})

const filteredCountries = computed(() => {
  if (!searchQuery.value) return countries
  const q = searchQuery.value.toLowerCase()
  return countries.filter(
    (c) => c.name.toLowerCase().includes(q) || c.alpha2.toLowerCase().includes(q),
  )
})

const { activeIndex, onKeydown, reset } = useListboxNav({
  itemCount: () => filteredCountries.value.length,
  onSelect: (index) => {
    const country = filteredCountries.value[index]
    if (country) select(country.alpha2)
  },
  onClose: () => {
    isOpen.value = false
  },
})

watch(searchQuery, () => reset())

async function toggleOpen() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    reset()
    await nextTick()
    searchInputRef.value?.focus()
  }
}

function select(alpha2: string) {
  emit("update:modelValue", alpha2)
  isOpen.value = false
  searchQuery.value = ""
}

function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener("click", handleClickOutside))
onUnmounted(() => document.removeEventListener("click", handleClickOutside))
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <button
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-controls="listboxId"
      class="focus-ring flex min-h-11 w-full items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-2.5 text-left text-sm transition hover:border-sand-300"
      @click.stop="toggleOpen"
    >
      <span :class="selectedName ? 'text-sand-900' : 'text-sand-700'">
        <template v-if="modelValue">{{ countryFlag(modelValue) }} </template>
        {{ selectedName ?? "Select your passport nationality" }}
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
        class="absolute z-20 mt-1 w-full origin-top rounded-xl border border-sand-200 bg-white shadow-lg"
      >
        <div class="border-b border-sand-100 p-2">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="isOpen"
            :aria-controls="listboxId"
            :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
            placeholder="Search countries..."
            class="w-full rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder-sand-400 focus:border-terra-400 focus:outline-none"
            @keydown="onKeydown"
          />
        </div>
        <ul :id="listboxId" role="listbox" class="max-h-60 overflow-y-auto py-1">
          <li
            v-for="(c, i) in filteredCountries"
            :id="optionId(i)"
            :key="c.alpha2"
            role="option"
            :aria-selected="c.alpha2 === modelValue"
            class="cursor-pointer px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-50"
            :class="{
              'bg-terra-50 text-terra-700': c.alpha2 === modelValue,
              'bg-sand-100': i === activeIndex,
            }"
            @click="select(c.alpha2)"
            @mousemove="activeIndex = i"
          >
            {{ countryFlag(c.alpha2) }} {{ c.name }}
            <span class="ml-1 text-xs text-sand-500">{{ c.alpha2 }}</span>
          </li>
          <li v-if="!filteredCountries.length" class="px-4 py-3 text-center text-sm text-sand-500">
            No countries found
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
