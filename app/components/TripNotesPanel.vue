<script setup lang="ts">
const props = defineProps<{
  tripId: string;
  notes: string | null;
}>();

const value = ref(props.notes ?? "");
const saved = ref(false);

watch(
  () => props.notes,
  (n) => {
    value.value = n ?? "";
  }
);

async function handleBlur() {
  try {
    await $fetch(`/api/trips/${props.tripId}`, {
      method: "PUT",
      body: { tripNotes: value.value },
    });
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 2000);
  } catch (e: unknown) {
    console.error("Failed to save notes:", e);
  }
}
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-6">
    <div class="flex items-center justify-between">
      <label class="text-sm font-semibold text-sand-700">Trip Notes</label>
      <span
        v-if="saved"
        class="text-xs text-forest-600 transition"
      >
        Saved
      </span>
    </div>
    <textarea
      v-model="value"
      rows="6"
      placeholder="Write your trip notes here..."
      class="mt-2 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
      @blur="handleBlur"
    />
  </div>
</template>
