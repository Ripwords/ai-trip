<script setup lang="ts">
interface Activity {
  id: string
  name: string
  type: string
  description: string | null
  placeId: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
  actualCost: string | null
  openingHours?: string[] | null
  priceLevel?: number | null
  [key: string]: unknown
}

function formatPriceLevel(level: number): string {
  return "$".repeat(Math.min(level, 4))
}

const props = defineProps<{
  activity: Activity | null
  open: boolean
  currencyCode?: string
  saving?: boolean
}>()

const { symbol: currencySymbol, code: currencyCodeResolved } = useCurrencyFormat(
  () => props.currencyCode,
)
const symbolText = computed(() => currencySymbol())

// openingHours / priceLevel are persisted at enrichment time, so we
// read them straight from the activity row. Images are temporarily
// disabled to eliminate Place Photo API spend.
const resolvedOpeningHours = computed(() => props.activity?.openingHours ?? [])
const resolvedPriceLevel = computed(() => props.activity?.priceLevel ?? null)

const emit = defineEmits<{
  save: [
    data: {
      name: string
      description: string | null
      suggestedTime: string | null
      estimatedDurationMinutes: number | null
      costEstimate: string | null
      notes: string | null
      actualCost: string | null
    },
  ]
  close: []
}>()

const name = ref("")
const description = ref("")
const suggestedTime = ref("")
const estimatedDurationMinutes = ref<number | null>(null)
const costEstimate = ref("")
const notes = ref("")
const actualCost = ref("")

watch(
  () => props.activity,
  (activity) => {
    if (activity) {
      name.value = activity.name
      description.value = activity.description ?? ""
      suggestedTime.value = activity.suggestedTime ?? ""
      estimatedDurationMinutes.value = activity.estimatedDurationMinutes
      costEstimate.value = activity.costEstimate ?? ""
      notes.value = activity.notes ?? ""
      actualCost.value = activity.actualCost ?? ""
    }
  },
  { immediate: true },
)

const dialogRef = ref<HTMLElement | null>(null)
useModalA11y(dialogRef, {
  isOpen: () => props.open,
  onClose: () => emit("close"),
})

// Freeze the page behind the modal: without this the list underneath scrolls
// under the finger and iOS rubber-bands the whole document.
useBodyScrollLock(() => props.open)

function handleSave() {
  emit("save", {
    name: name.value,
    description: description.value || null,
    suggestedTime: suggestedTime.value || null,
    estimatedDurationMinutes: estimatedDurationMinutes.value,
    costEstimate: costEstimate.value || null,
    notes: notes.value || null,
    actualCost: actualCost.value || null,
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/40" @click="emit('close')" />
      <div
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-activity-title"
        tabindex="-1"
        class="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl mx-4"
      >
        <h2 id="edit-activity-title" class="text-lg font-display text-sand-900">Edit Activity</h2>

        <form class="mt-4 space-y-4" @submit.prevent="handleSave">
          <div>
            <label class="block text-sm font-medium text-sand-700">Name</label>
            <input
              v-model="name"
              type="text"
              required
              class="mt-1 block min-h-11 w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-sand-700">Description</label>
            <textarea
              v-model="description"
              rows="3"
              class="mt-1 block min-h-11 w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-sand-700">Suggested Time</label>
              <input
                v-model="suggestedTime"
                type="time"
                class="mt-1 block min-h-11 w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-sand-700">Duration (min)</label>
              <input
                v-model.number="estimatedDurationMinutes"
                type="number"
                min="0"
                class="mt-1 block min-h-11 w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-sand-700"
                >Cost Estimate ({{ currencyCodeResolved }})</label
              >
              <div class="relative mt-1">
                <span
                  class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-sand-700"
                >
                  {{ symbolText }}
                </span>
                <input
                  v-model="costEstimate"
                  type="text"
                  inputmode="decimal"
                  placeholder="0"
                  class="block min-h-11 w-full rounded-lg border border-sand-300 py-2 pl-8 pr-3 text-sm input-focus"
                />
              </div>
            </div>
            <!-- The "Actual Cost" input is gone (#39). Actual spend is now
                 derived from the expenses linked to an activity, and a second
                 hand-typed number could only ever contradict it. `actualCost`
                 is still round-tripped below so editing an activity does not
                 quietly erase a value entered before this changed. -->
          </div>

          <div>
            <label class="block text-sm font-medium text-sand-700">Notes</label>
            <textarea
              v-model="notes"
              rows="2"
              placeholder="Any notes about this activity..."
              class="mt-1 block min-h-11 w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>

          <!-- Opening hours (lazy-loaded from Google Maps) -->
          <details v-if="resolvedOpeningHours.length" class="group">
            <summary
              class="flex cursor-pointer items-center gap-1 text-sm font-medium text-sand-700"
            >
              <Icon name="lucide:clock" class="h-3.5 w-3.5" />
              Opening Hours
              <span
                v-if="resolvedPriceLevel != null && resolvedPriceLevel > 0"
                class="ml-2 text-xs font-medium text-forest-600"
              >
                {{ formatPriceLevel(resolvedPriceLevel) }}
              </span>
              <Icon
                name="lucide:chevron-down"
                class="ml-auto h-3.5 w-3.5 transition group-open:rotate-180"
              />
            </summary>
            <ul class="mt-2 space-y-0.5 text-sm text-sand-600">
              <li v-for="(hour, i) in resolvedOpeningHours" :key="i">{{ hour }}</li>
            </ul>
          </details>

          <div class="flex justify-end gap-3 pt-2">
            <button
              type="button"
              class="inline-flex min-h-11 items-center rounded-lg border border-sand-300 px-4 text-sm font-medium text-sand-700 hover:bg-sand-50"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-cta px-4 text-sm font-medium text-white hover:bg-cta-hover disabled:opacity-50"
            >
              <Icon v-if="saving" name="lucide:loader" class="h-4 w-4 animate-spin" />
              {{ saving ? "Saving..." : "Save" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
