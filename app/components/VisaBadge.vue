<script setup lang="ts">
const props = defineProps<{
  destinationCountry: string
}>()

const { data: visaResult } = await useFetch("/api/visa/check", {
  query: { destination: props.destinationCountry },
  immediate: !!props.destinationCountry,
})

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  "visa-free": {
    label: "Visa Free",
    color: "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800",
    icon: "lucide:check-circle",
  },
  "visa-on-arrival": {
    label: "Visa on Arrival",
    color: "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800",
    icon: "lucide:clock",
  },
  evisa: {
    label: "e-Visa",
    color: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800",
    icon: "lucide:globe",
  },
  "visa-required": {
    label: "Visa Required",
    color: "text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800",
    icon: "lucide:shield-alert",
  },
}

const config = computed(() => {
  if (!visaResult.value) return null
  return statusConfig[visaResult.value.visaStatus] ?? null
})
</script>

<template>
  <span
    v-if="config && visaResult"
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
    :class="config.color"
  >
    <Icon :name="config.icon" class="h-3 w-3" />
    {{ config.label }}
    <span v-if="visaResult.maxStayDays" class="opacity-75">
      ({{ visaResult.maxStayDays }}d)
    </span>
  </span>
</template>
