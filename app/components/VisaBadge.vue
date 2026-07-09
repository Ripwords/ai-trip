<script setup lang="ts">
const props = defineProps<{
  destinationCountry: string
  /** Pre-fetched visa status — skips the API call when provided */
  visaStatus?: string
  maxStayDays?: number | null
}>()

const { data: fetchedResult } = await useFetch("/api/visa/check", {
  query: { destination: props.destinationCountry },
  immediate: !props.visaStatus,
})

const status = computed(() => props.visaStatus ?? fetchedResult.value?.visaStatus)
const days = computed(() => props.maxStayDays ?? fetchedResult.value?.maxStayDays)

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  "visa-free": {
    label: "Visa Free",
    color: "text-forest-700 bg-forest-50 border-forest-200",
    icon: "lucide:check-circle",
  },
  "visa-on-arrival": {
    label: "Visa on Arrival",
    color: "text-ocean-700 bg-ocean-50 border-ocean-200",
    icon: "lucide:clock",
  },
  evisa: {
    label: "e-Visa",
    color: "text-amber-700 bg-amber-50 border-amber-200",
    icon: "lucide:globe",
  },
  "visa-required": {
    label: "Visa Required",
    color:
      "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800",
    icon: "lucide:shield-alert",
  },
}

const config = computed(() => {
  if (!status.value) return null
  return statusConfig[status.value] ?? null
})
</script>

<template>
  <span
    v-if="config"
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="config.color"
  >
    <Icon :name="config.icon" class="h-3 w-3" />
    {{ config.label }}
    <span v-if="days" class="opacity-75"> ({{ days }}d) </span>
  </span>
</template>
