<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  select: [tripId: string]
  close: []
}>()

const { data: trips } = await useFetch<
  { id: string; destination: string; startDate: string; endDate: string }[]
>("/api/trips", {
  transform: (data: { id: string; destination: string; startDate: string; endDate: string }[]) =>
    data.map((t) => ({
      id: t.id,
      destination: t.destination,
      startDate: t.startDate,
      endDate: t.endDate,
    })),
})

const search = ref("")
const today = new Date().toISOString().split("T")[0]!

const filtered = computed(() => {
  const upcoming = (trips.value ?? []).filter((t) => t.endDate >= today)
  const q = search.value.toLowerCase().trim()
  if (!q) return upcoming
  return upcoming.filter((t) => t.destination.toLowerCase().includes(q))
})

function selectTrip(tripId: string) {
  emit("select", tripId)
  search.value = ""
}

function close() {
  emit("close")
  search.value = ""
}

const searchInput = ref<HTMLInputElement>()

watch(
  () => props.open,
  (val) => {
    if (val) {
      nextTick(() => searchInput.value?.focus())
    }
  },
)
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
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="fixed inset-0 bg-black/40" @click="close" />
        <div class="relative z-10 mx-4 w-full max-w-md rounded-2xl bg-white shadow-2xl">
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-sand-200 px-5 py-4">
            <h3 class="font-display text-base text-sand-900">Link to trip</h3>
            <button class="rounded-lg p-1.5 text-sand-400 hover:bg-sand-100" @click="close">
              <Icon name="lucide:x" class="h-4 w-4" />
            </button>
          </div>

          <!-- Search -->
          <div class="px-5 pt-4">
            <input
              ref="searchInput"
              v-model="search"
              type="text"
              placeholder="Search trips..."
              class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-400 focus:border-terra-400 focus:outline-none"
            />
          </div>

          <!-- Trip list -->
          <div class="max-h-64 overflow-y-auto px-2 py-3">
            <button
              v-for="trip in filtered"
              :key="trip.id"
              class="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition hover:bg-sand-50"
              @click="selectTrip(trip.id)"
            >
              <div>
                <p class="text-sm font-medium text-sand-900">{{ trip.destination }}</p>
                <p class="text-xs text-sand-500">
                  <NuxtTime
                    :datetime="trip.startDate + 'T00:00:00'"
                    locale="en-US"
                    month="short"
                    day="numeric"
                  />
                  –
                  <NuxtTime
                    :datetime="trip.endDate + 'T00:00:00'"
                    locale="en-US"
                    month="short"
                    day="numeric"
                    year="numeric"
                  />
                </p>
              </div>
              <Icon name="lucide:chevron-right" class="h-4 w-4 text-sand-400" />
            </button>
            <p v-if="filtered.length === 0" class="px-3 py-6 text-center text-sm text-sand-400">
              {{ search ? "No trips match your search" : "No trips yet" }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
