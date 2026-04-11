<script setup lang="ts">
import type { CountryInfo } from "../data/countries"
import type { VisitType } from "./ScratchMap.vue"

const props = defineProps<{
  country: CountryInfo | null
  visitType: VisitType | undefined
  loading: boolean
}>()

const emit = defineEmits<{
  close: []
  setVisitType: [country: CountryInfo, type: VisitType | null]
  checkVisa: [country: CountryInfo]
}>()

const panelRef = ref<HTMLElement | null>(null)
const mobileSheetRef = ref<HTMLElement | null>(null)

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.country) emit("close")
}

function handleClickOutside(e: MouseEvent) {
  if (!props.country) return
  const target = e.target as Node
  // Guard: if neither panel has mounted yet (DOM not flushed after v-if toggle), bail
  if (!panelRef.value && !mobileSheetRef.value) return
  if (panelRef.value?.contains(target) || mobileSheetRef.value?.contains(target)) return
  emit("close")
}

onMounted(() => {
  document.addEventListener("keydown", handleKeydown)
  document.addEventListener("pointerup", handleClickOutside)
})
onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown)
  document.removeEventListener("pointerup", handleClickOutside)
})

function handleSetType(type: VisitType) {
  if (!props.country) return
  // If already this type, clear it (toggle off)
  if (props.visitType === type) {
    emit("setVisitType", props.country, null)
  } else {
    emit("setVisitType", props.country, type)
  }
}
</script>

<template>
  <!-- Desktop: right sidebar -->
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
      ref="panelRef"
      class="absolute inset-y-0 right-0 z-10 hidden w-full max-w-sm flex-col border-l border-sand-200 bg-white shadow-xl sm:flex"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-sand-200 px-5 py-4">
        <div>
          <h2 class="font-display text-lg text-sand-900">
            {{ country.name }}
          </h2>
          <p class="text-sm text-sand-500">{{ country.region }} &middot; {{ country.alpha2 }}</p>
        </div>
        <button
          class="rounded-lg p-2 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 space-y-3 overflow-y-auto p-5">
        <p class="text-xs font-medium uppercase tracking-wider text-sand-400">Mark as</p>

        <!-- Visited button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="
            visitType === 'visited'
              ? 'border-terra-300 bg-terra-50 text-terra-700'
              : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50'
          "
          :disabled="loading"
          @click="handleSetType('visited')"
        >
          <Icon
            :name="visitType === 'visited' ? 'lucide:check-circle-2' : 'lucide:circle'"
            class="h-5 w-5 shrink-0"
          />
          <div>
            <p class="font-medium">Visited</p>
            <p class="text-xs opacity-70">
              {{ visitType === "visited" ? "Click to remove" : "Been here and explored" }}
            </p>
          </div>
        </button>

        <!-- Layover button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="
            visitType === 'layover'
              ? 'border-ocean-300 bg-ocean-50 text-ocean-700'
              : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50'
          "
          :disabled="loading"
          @click="handleSetType('layover')"
        >
          <Icon
            :name="visitType === 'layover' ? 'lucide:check-circle-2' : 'lucide:circle'"
            class="h-5 w-5 shrink-0"
          />
          <div>
            <p class="font-medium">Layover</p>
            <p class="text-xs opacity-70">
              {{ visitType === "layover" ? "Click to remove" : "Transit or brief stop" }}
            </p>
          </div>
        </button>

        <!-- Want to visit button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="
            visitType === 'want_to_visit'
              ? 'border-purple-300 bg-purple-50 text-purple-700'
              : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50'
          "
          :disabled="loading"
          @click="handleSetType('want_to_visit')"
        >
          <Icon
            :name="visitType === 'want_to_visit' ? 'lucide:check-circle-2' : 'lucide:circle'"
            class="h-5 w-5 shrink-0"
          />
          <div>
            <p class="font-medium">Want to visit</p>
            <p class="text-xs opacity-70">
              {{ visitType === "want_to_visit" ? "Click to remove" : "On your bucket list" }}
            </p>
          </div>
        </button>

        <div class="my-2 border-t border-sand-100" />

        <!-- Visa check button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border border-sand-200 px-4 py-3 text-left text-sand-700 transition hover:border-sand-300 hover:bg-sand-50"
          @click="emit('checkVisa', country)"
        >
          <Icon name="lucide:shield-check" class="h-5 w-5 shrink-0 text-ocean-500" />
          <div>
            <p class="font-medium">Check visa requirements</p>
            <p class="text-xs opacity-70">See if you need a visa to visit</p>
          </div>
        </button>
      </div>
    </div>
  </Transition>

  <!-- Mobile: bottom sheet -->
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="duration-150 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="country"
      ref="mobileSheetRef"
      class="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-sand-200 bg-white shadow-2xl sm:hidden"
      style="max-height: 60vh"
    >
      <!-- Drag handle -->
      <div class="flex justify-center py-2.5">
        <div class="h-1 w-10 rounded-full bg-sand-300" />
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between px-5 pb-3">
        <div>
          <h2 class="font-display text-lg text-sand-900">
            {{ country.name }}
          </h2>
          <p class="text-sm text-sand-500">{{ country.region }} &middot; {{ country.alpha2 }}</p>
        </div>
        <button
          class="rounded-lg p-2 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
          @click="emit('close')"
        >
          <Icon name="lucide:x" class="h-5 w-5" />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 space-y-2.5 overflow-y-auto px-5 pb-5">
        <p class="text-xs font-medium uppercase tracking-wider text-sand-400">Mark as</p>

        <div class="grid grid-cols-3 gap-2">
          <button
            class="flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition"
            :class="
              visitType === 'visited'
                ? 'border-terra-300 bg-terra-50 text-terra-700'
                : 'border-sand-200 text-sand-600 hover:bg-sand-50'
            "
            :disabled="loading"
            @click="handleSetType('visited')"
          >
            <Icon
              :name="visitType === 'visited' ? 'lucide:check-circle-2' : 'lucide:circle'"
              class="h-5 w-5"
            />
            <span class="text-xs font-medium">Visited</span>
          </button>

          <button
            class="flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition"
            :class="
              visitType === 'layover'
                ? 'border-ocean-300 bg-ocean-50 text-ocean-700'
                : 'border-sand-200 text-sand-600 hover:bg-sand-50'
            "
            :disabled="loading"
            @click="handleSetType('layover')"
          >
            <Icon
              :name="visitType === 'layover' ? 'lucide:check-circle-2' : 'lucide:circle'"
              class="h-5 w-5"
            />
            <span class="text-xs font-medium">Layover</span>
          </button>

          <button
            class="flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition"
            :class="
              visitType === 'want_to_visit'
                ? 'border-purple-300 bg-purple-50 text-purple-700'
                : 'border-sand-200 text-sand-600 hover:bg-sand-50'
            "
            :disabled="loading"
            @click="handleSetType('want_to_visit')"
          >
            <Icon
              :name="visitType === 'want_to_visit' ? 'lucide:check-circle-2' : 'lucide:circle'"
              class="h-5 w-5"
            />
            <span class="text-xs font-medium">Wishlist</span>
          </button>
        </div>

        <!-- Visa check button -->
        <button
          class="flex w-full items-center justify-center gap-2 rounded-xl border border-sand-200 px-4 py-3 text-sm font-medium text-sand-700 transition hover:bg-sand-50"
          @click="emit('checkVisa', country)"
        >
          <Icon name="lucide:shield-check" class="h-4 w-4 text-ocean-500" />
          Check visa requirements
        </button>
      </div>
    </div>
  </Transition>

  <!-- Mobile backdrop -->
  <Transition
    enter-active-class="duration-200 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="country"
      class="fixed inset-0 z-40 bg-black/20 sm:hidden"
      @click="emit('close')"
    />
  </Transition>
</template>
