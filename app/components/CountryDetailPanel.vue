<script setup lang="ts">
import type { CountryInfo } from "../data/countries";
import type { VisitType } from "./ScratchMap.vue";

const props = defineProps<{
  country: CountryInfo | null;
  visitType: VisitType | undefined;
  loading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  setVisitType: [country: CountryInfo, type: VisitType | null];
  checkVisa: [country: CountryInfo];
}>();

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.country) emit("close");
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onUnmounted(() => document.removeEventListener("keydown", handleKeydown));

function handleSetType(type: VisitType) {
  if (!props.country) return;
  // If already this type, clear it (toggle off)
  if (props.visitType === type) {
    emit("setVisitType", props.country, null);
  } else {
    emit("setVisitType", props.country, type);
  }
}
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
      class="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-sand-200 bg-white shadow-xl"
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
          :class="visitType === 'visited'
            ? 'border-terra-300 bg-terra-50 text-terra-700'
            : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50'"
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
              {{ visitType === 'visited' ? 'Click to remove' : 'Been here and explored' }}
            </p>
          </div>
        </button>

        <!-- Layover button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="visitType === 'layover'
            ? 'border-ocean-300 bg-ocean-50 text-ocean-700'
            : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50'"
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
              {{ visitType === 'layover' ? 'Click to remove' : 'Transit or brief stop' }}
            </p>
          </div>
        </button>

        <!-- Want to visit button -->
        <button
          class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition"
          :class="visitType === 'want_to_visit'
            ? 'border-purple-300 bg-purple-50 text-purple-700'
            : 'border-sand-200 text-sand-700 hover:border-sand-300 hover:bg-sand-50'"
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
              {{ visitType === 'want_to_visit' ? 'Click to remove' : 'On your bucket list' }}
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
</template>
