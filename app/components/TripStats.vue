<script setup lang="ts">
interface Activity {
  type: string;
  costEstimate: string | null;
}

interface Day {
  activities: Activity[];
}

const props = defineProps<{
  days: Day[];
  budget?: string | null;
  currencyCode?: string;
  totalExpenses?: number;
}>();

const totalActivities = computed(() =>
  props.days.reduce((sum, day) => sum + day.activities.length, 0)
);

const totalCost = computed(() => {
  let sum = 0;
  for (const day of props.days) {
    for (const activity of day.activities) {
      if (activity.costEstimate) {
        sum += parseFloat(activity.costEstimate);
      }
    }
  }
  return sum;
});

const totalDays = computed(() => props.days.length);

const typeBreakdown = computed(() => {
  const counts: Record<string, number> = {};
  for (const day of props.days) {
    for (const activity of day.activities) {
      counts[activity.type] = (counts[activity.type] || 0) + 1;
    }
  }
  return counts;
});

const budgetNum = computed(() =>
  props.budget ? parseFloat(props.budget) : null
);

const budgetPercent = computed(() => {
  if (!budgetNum.value || budgetNum.value === 0 || !props.totalExpenses) return 0;
  return (props.totalExpenses / budgetNum.value) * 100;
});

const progressBarColor = computed(() => {
  if (budgetPercent.value >= 100) return "bg-terra-600";
  if (budgetPercent.value >= 80) return "bg-terra-400";
  return "bg-forest-500";
});

const typeBadgeClasses: Record<string, string> = {
  attraction: "bg-ocean-50 text-ocean-700",
  restaurant: "bg-terra-50 text-terra-700",
  hotel: "bg-ocean-50 text-ocean-700",
  transport: "bg-sand-100 text-sand-700",
  shopping: "bg-terra-50 text-terra-600",
  entertainment: "bg-forest-50 text-forest-700",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: props.currencyCode || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
</script>

<template>
  <div class="rounded-2xl bg-sand-100 p-6">
    <h3 class="text-sm font-semibold text-sand-900">Trip Summary</h3>

    <div class="mt-4 grid grid-cols-3 gap-4">
      <div class="text-center">
        <p class="text-2xl font-display text-sand-900">{{ totalDays }}</p>
        <p class="text-xs text-sand-500">Days</p>
      </div>
      <div class="text-center">
        <p class="text-2xl font-display text-sand-900">{{ totalActivities }}</p>
        <p class="text-xs text-sand-500">Activities</p>
      </div>
      <div class="text-center">
        <p class="text-2xl font-display text-sand-900">
          {{ formatCurrency(totalCost) }}
        </p>
        <p class="text-xs text-sand-500">Est. Cost</p>
      </div>
    </div>

    <!-- Budget & Spend -->
    <div v-if="budgetNum || totalExpenses" class="mt-4 space-y-2 border-t border-sand-200 pt-4">
      <div v-if="budgetNum" class="flex items-center justify-between text-sm">
        <span class="text-sand-600">Budget</span>
        <span class="font-semibold text-sand-900">{{ formatCurrency(budgetNum) }}</span>
      </div>
      <div v-if="totalExpenses != null && totalExpenses > 0" class="flex items-center justify-between text-sm">
        <span class="text-sand-600">Spent</span>
        <span class="font-semibold text-sand-900">{{ formatCurrency(totalExpenses) }}</span>
      </div>
      <div v-if="budgetNum && totalExpenses" class="mt-1">
        <div class="h-1.5 w-full rounded-full bg-sand-200">
          <div
            class="h-1.5 rounded-full transition-all"
            :class="progressBarColor"
            :style="{ width: `${Math.min(budgetPercent, 100)}%` }"
          />
        </div>
      </div>
    </div>

    <div v-if="Object.keys(typeBreakdown).length" class="mt-4 flex flex-wrap gap-2">
      <span
        v-for="(count, type) in typeBreakdown"
        :key="type"
        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
        :class="typeBadgeClasses[type as string] || 'bg-sand-100 text-sand-700'"
      >
        {{ formatType(type as string) }}
        <span class="font-bold">{{ count }}</span>
      </span>
    </div>
  </div>
</template>
