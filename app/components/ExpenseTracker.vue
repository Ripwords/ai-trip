<script setup lang="ts">
interface Expense {
  id: string;
  description: string;
  amount: string;
  category: string;
  paidAt: string | null;
}

const props = defineProps<{
  tripId: string;
  budget: string | null;
  currencyCode: string;
}>();

const { data: expenses, refresh } = await useFetch<Expense[]>(
  `/api/trips/${props.tripId}/expenses`
);

const editingBudget = ref(false);
const budgetInput = ref(props.budget ?? "");
const showAddForm = ref(false);

// Add form fields
const newDescription = ref("");
const newAmount = ref("");
const newCategory = ref("food");
const newDate = ref(new Date().toISOString().split("T")[0]);

const categories = [
  "accommodation",
  "food",
  "transport",
  "activity",
  "shopping",
  "other",
];

const categoryBadgeClasses: Record<string, string> = {
  accommodation: "bg-ocean-50 text-ocean-700",
  food: "bg-terra-50 text-terra-700",
  transport: "bg-sand-100 text-sand-700",
  activity: "bg-ocean-50 text-ocean-700",
  shopping: "bg-terra-50 text-terra-600",
  other: "bg-sand-100 text-sand-700",
};

const totalExpenses = computed(() => {
  if (!expenses.value) return 0;
  return expenses.value.reduce((sum, e) => sum + parseFloat(e.amount), 0);
});

const budgetNum = computed(() =>
  props.budget ? parseFloat(props.budget) : null
);

const budgetPercent = computed(() => {
  if (!budgetNum.value || budgetNum.value === 0) return 0;
  return (totalExpenses.value / budgetNum.value) * 100;
});

const progressBarColor = computed(() => {
  if (budgetPercent.value >= 100) return "bg-terra-600";
  if (budgetPercent.value >= 80) return "bg-terra-400";
  return "bg-forest-500";
});

watch(
  () => props.budget,
  (b) => {
    budgetInput.value = b ?? "";
  }
);

async function saveBudget() {
  try {
    await $fetch(`/api/trips/${props.tripId}`, {
      method: "PUT",
      body: { budget: budgetInput.value || null },
    });
    editingBudget.value = false;
  } catch (e: unknown) {
    console.error("Failed to save budget:", e);
  }
}

async function addExpense() {
  if (!newDescription.value.trim() || !newAmount.value) return;
  try {
    await $fetch(`/api/trips/${props.tripId}/expenses`, {
      method: "POST",
      body: {
        description: newDescription.value,
        amount: newAmount.value,
        category: newCategory.value,
        paidAt: newDate.value ? new Date(newDate.value).toISOString() : undefined,
      },
    });
    newDescription.value = "";
    newAmount.value = "";
    newCategory.value = "food";
    newDate.value = new Date().toISOString().split("T")[0];
    showAddForm.value = false;
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to add expense:", e);
  }
}

async function deleteExpense(expenseId: string) {
  try {
    await $fetch(`/api/trips/${props.tripId}/expenses/${expenseId}`, {
      method: "DELETE",
    });
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to delete expense:", e);
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: props.currencyCode || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Budget section -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Budget</h3>
        <button
          class="rounded p-1 text-sand-400 hover:bg-terra-50 hover:text-terra-600"
          @click="editingBudget = !editingBudget"
        >
          <Icon name="lucide:edit" class="h-4 w-4" />
        </button>
      </div>

      <div v-if="editingBudget" class="mt-3 flex gap-2">
        <input
          v-model="budgetInput"
          type="text"
          placeholder="e.g. 2000"
          class="block flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
        />
        <button
          class="rounded-lg bg-terra-500 px-3 py-2 text-sm font-medium text-white hover:bg-terra-600"
          @click="saveBudget"
        >
          Save
        </button>
      </div>

      <div class="mt-3">
        <div class="flex items-baseline justify-between">
          <p class="text-sm text-sand-600">
            Total: <span class="font-semibold text-sand-900">{{ formatCurrency(totalExpenses) }}</span>
          </p>
          <p v-if="budgetNum" class="text-sm text-sand-500">
            Budget: {{ formatCurrency(budgetNum) }}
          </p>
        </div>

        <div v-if="budgetNum" class="mt-2">
          <div class="h-2 w-full rounded-full bg-sand-200">
            <div
              class="h-2 rounded-full transition-all"
              :class="progressBarColor"
              :style="{ width: `${Math.min(budgetPercent, 100)}%` }"
            />
          </div>
          <p class="mt-1 text-xs text-sand-500">
            {{ budgetPercent.toFixed(0) }}% used
          </p>
        </div>
      </div>
    </div>

    <!-- Expenses section -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Expenses</h3>
        <button
          class="inline-flex items-center gap-1 rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600"
          @click="showAddForm = !showAddForm"
        >
          <Icon name="lucide:plus" class="h-3 w-3" />
          Add
        </button>
      </div>

      <!-- Add form -->
      <form v-if="showAddForm" class="mt-4 space-y-3 border-b border-sand-100 pb-4" @submit.prevent="addExpense">
        <div>
          <input
            v-model="newDescription"
            type="text"
            placeholder="Description"
            required
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <input
            v-model="newAmount"
            type="number"
            step="0.01"
            placeholder="Amount"
            required
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
          <select
            v-model="newCategory"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          >
            <option v-for="cat in categories" :key="cat" :value="cat">
              {{ cat }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-3">
          <input
            v-model="newDate"
            type="date"
            class="block flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
          <button
            type="submit"
            class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600"
          >
            Add
          </button>
        </div>
      </form>

      <!-- Expense list -->
      <div v-if="expenses?.length" class="mt-4 space-y-2">
        <div
          v-for="expense in expenses"
          :key="expense.id"
          class="flex items-center justify-between rounded-xl border border-sand-200 px-3 py-2"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-sand-900 truncate">{{ expense.description }}</p>
            <div class="mt-0.5 flex items-center gap-2 text-xs text-sand-500">
              <span
                class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                :class="categoryBadgeClasses[expense.category] || 'bg-sand-100 text-sand-700'"
              >
                {{ expense.category }}
              </span>
              <span v-if="expense.paidAt">{{ new Date(expense.paidAt).toLocaleDateString() }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-sand-900">
              {{ formatCurrency(parseFloat(expense.amount)) }}
            </span>
            <button
              class="rounded p-1 text-sand-300 hover:text-red-500"
              @click="deleteExpense(expense.id)"
            >
              <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <p v-else class="mt-4 text-center text-xs text-sand-400">
        No expenses tracked yet.
      </p>
    </div>
  </div>
</template>
