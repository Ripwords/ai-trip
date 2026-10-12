<script setup lang="ts">
const props = defineProps<{
  tripId: string
  notes: string | null
}>()

const emit = defineEmits<{
  /** The text now stored, so the page's copy of the trip stays current. */
  saved: [notes: string | null]
}>()

const value = ref(props.notes ?? "")
const saved = ref(false)
const toast = useToast()

const textareaId = useId()

watch(
  () => props.notes,
  (n) => {
    value.value = n ?? ""
  },
)

async function handleBlur() {
  // An unchanged blur must not save: it would write this panel's copy back over
  // whatever is stored now.
  if (!noteChanged(props.notes, value.value)) return
  const tripNotes = normalizeNote(value.value)
  try {
    await $fetch(`/api/trips/${props.tripId}`, {
      method: "PUT",
      body: { tripNotes },
    })
    emit("saved", tripNotes)
    saved.value = true
    setTimeout(() => {
      saved.value = false
    }, 2000)
  } catch (e: unknown) {
    console.error("Failed to save notes:", e)
    toast.error("Could not save the trip notes. Please try again.")
  }
}
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-6">
    <div class="flex items-center justify-between">
      <label :for="textareaId" class="text-sm font-semibold text-sand-700">Trip Notes</label>
      <span role="status" aria-live="polite" class="text-xs text-forest-600 transition">
        <template v-if="saved">Saved</template>
      </span>
    </div>
    <textarea
      :id="textareaId"
      v-model="value"
      rows="6"
      placeholder="Write your trip notes here..."
      class="mt-2 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
      @blur="handleBlur"
    />
  </div>
</template>
