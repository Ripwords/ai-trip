<script setup lang="ts">
interface Expense {
  id: string
  description: string
  amount: string
  category: string
  paidById: string | null
  paidAt: string | null
}

interface Member {
  userId: string
  user: { name: string; image: string | null }
  role: string
}

const props = defineProps<{
  tripId: string
  tripName: string
  budget: string | null
  currencyCode: string
  members?: Member[]
}>()

const emit = defineEmits<{
  budgetUpdated: []
}>()

const { downloadCsv } = useExportExpenses()

const { data: expenses, refresh } = await useFetch<Expense[]>(`/api/trips/${props.tripId}/expenses`)

const editingBudget = ref(false)
const budgetInput = ref(props.budget ?? "")
const showAddForm = ref(false)
const editingExpenseId = ref<string | null>(null)
const savingBudget = ref(false)
const submittingExpense = ref(false)

const uid = useId()
const descriptionId = `${uid}-description`
const amountId = `${uid}-amount`
const categoryId = `${uid}-category`
const dateId = `${uid}-date`
const paidById = `${uid}-paid-by`

// Form fields
const formDescription = ref("")
const formAmount = ref("")
const formCategory = ref("food")
const formDate = ref(todayCalendarDate())
const formPaidById = ref<string>("")

// Both come from shared/utils/expense-categories.ts — the same list the server
// validates against, so the picker can't fall out of sync with the enum.
const categories = EXPENSE_CATEGORIES

const totalExpenses = computed(() => {
  if (!expenses.value) return 0
  return expenses.value.reduce((sum, e) => sum + parseFloat(e.amount), 0)
})

const budgetNum = computed(() => (props.budget ? parseFloat(props.budget) : null))

const budgetPercent = computed(() => {
  if (!budgetNum.value || budgetNum.value === 0) return 0
  return (totalExpenses.value / budgetNum.value) * 100
})

const progressBarColor = computed(() => {
  if (budgetPercent.value >= 100) return "bg-red-600"
  if (budgetPercent.value >= 80) return "bg-amber-500"
  return "bg-forest-500"
})

// Equal-split settlement. The maths lives in app/utils/settlement.ts so it can
// be unit-tested — see that file for why unattributed expenses are surfaced
// rather than silently excluded.
const settlementResult = computed(() =>
  computeSettlement(expenses.value ?? [], props.members ?? []),
)
const settlement = computed(() => settlementResult.value.balances)
const unattributedTotal = computed(() => settlementResult.value.unattributedTotal)

watch(
  () => props.budget,
  (b) => {
    budgetInput.value = b ?? ""
  },
)

function resetForm() {
  formDescription.value = ""
  formAmount.value = ""
  formCategory.value = "food"
  formDate.value = todayCalendarDate()
  formPaidById.value = ""
  editingExpenseId.value = null
}

function startEdit(expense: Expense) {
  editingExpenseId.value = expense.id
  formDescription.value = expense.description
  formAmount.value = expense.amount
  formCategory.value = expense.category
  // paidAt is already a plain YYYY-MM-DD calendar date — parsing it into a
  // Date and back reintroduced the UTC/local shift this column exists to avoid.
  formDate.value = expense.paidAt ?? ""
  formPaidById.value = expense.paidById ?? ""
  showAddForm.value = true
}

const toast = useToast()

async function saveBudget() {
  if (savingBudget.value) return
  savingBudget.value = true
  try {
    await $fetch(`/api/trips/${props.tripId}`, {
      method: "PUT",
      body: { budget: budgetInput.value || null },
    })
    editingBudget.value = false
    emit("budgetUpdated")
  } catch (e: unknown) {
    console.error("Failed to save budget:", e)
    toast.error("Couldn't save budget. Please try again.")
  } finally {
    savingBudget.value = false
  }
}

async function submitExpense() {
  if (!formDescription.value.trim() || !formAmount.value) return
  if (submittingExpense.value) return
  submittingExpense.value = true
  try {
    const body: Record<string, unknown> = {
      description: formDescription.value,
      amount: formAmount.value,
      category: formCategory.value,
      paidAt: formDate.value || undefined,
      paidById: formPaidById.value || undefined,
    }

    if (editingExpenseId.value) {
      await $fetch(`/api/trips/${props.tripId}/expenses/${editingExpenseId.value}`, {
        method: "PUT",
        body,
      })
    } else {
      await $fetch(`/api/trips/${props.tripId}/expenses`, {
        method: "POST",
        body,
      })
    }
    resetForm()
    showAddForm.value = false
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to save expense:", e)
    toast.error("Couldn't save expense. Please try again.")
  } finally {
    submittingExpense.value = false
  }
}

const { confirm } = useConfirm()

async function deleteExpense(expenseId: string) {
  const ok = await confirm({
    title: "Delete expense",
    message: "Delete this expense? This cannot be undone.",
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/trips/${props.tripId}/expenses/${expenseId}`, {
      method: "DELETE",
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete expense:", e)
  }
}

const { format: formatCurrencyRaw } = useCurrencyFormat(() => props.currencyCode)

function formatCurrency(amount: number): string {
  return formatCurrencyRaw(amount)
}

function getMemberName(userId: string | null): string {
  if (!userId || !props.members) return ""
  const member = props.members.find((m) => m.userId === userId)
  return member?.user.name ?? ""
}
</script>

<template>
  <div class="space-y-6">
    <!-- Budget section -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Budget</h3>
        <button
          type="button"
          class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 hover:bg-terra-50 hover:text-terra-600 focus-ring"
          aria-label="Edit budget"
          :aria-expanded="editingBudget"
          @click="editingBudget = !editingBudget"
        >
          <Icon name="lucide:edit" class="h-4 w-4" />
        </button>
      </div>

      <div v-if="editingBudget" class="mt-3 flex gap-2">
        <label :for="`${uid}-budget`" class="sr-only">Budget amount</label>
        <input
          :id="`${uid}-budget`"
          v-model="budgetInput"
          type="text"
          placeholder="e.g. 2000"
          class="block flex-1 rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
        />
        <button
          type="button"
          :disabled="savingBudget"
          class="min-h-11 rounded-lg bg-terra-500 px-3 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
          @click="saveBudget"
        >
          {{ savingBudget ? "Saving..." : "Save" }}
        </button>
      </div>

      <div class="mt-3">
        <div class="flex items-baseline justify-between">
          <p class="text-sm text-sand-600">
            Total:
            <span class="font-semibold text-sand-900 tabular-nums">
              {{ formatCurrency(totalExpenses) }}
            </span>
          </p>
          <p v-if="budgetNum" class="text-sm text-sand-500 tabular-nums">
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
          <p class="mt-1 text-xs text-sand-500 tabular-nums">
            {{ budgetPercent.toFixed(0) }}% used
          </p>
        </div>
      </div>
    </div>

    <!-- Settlement summary (only for group trips with paid-by data) -->
    <div
      v-if="settlement.length > 0 || unattributedTotal > 0"
      class="rounded-2xl border border-sand-200 bg-white p-6"
    >
      <h3 class="text-sm font-semibold text-sand-900">Settlement</h3>
      <div v-if="settlement.length > 0" class="mt-3 space-y-2">
        <div
          v-for="person in settlement"
          :key="person.userId"
          class="flex items-center justify-between text-sm"
        >
          <span class="text-sand-700">{{ person.name }}</span>
          <span
            class="font-medium tabular-nums"
            :class="person.balance > 0 ? 'text-forest-600' : 'text-terra-600'"
          >
            {{ person.balance > 0 ? "is owed" : "owes" }}
            {{ formatCurrency(Math.abs(person.balance)) }}
          </span>
        </div>
      </div>
      <!-- Without this the settlement silently ignores these expenses while the
           total above still counts them, and the two numbers never reconcile. -->
      <p
        v-if="unattributedTotal > 0"
        class="mt-3 border-t border-sand-100 pt-3 text-xs text-sand-500"
      >
        {{ formatCurrency(unattributedTotal) }} not included — no payer recorded. Edit those
        expenses to set who paid.
      </p>
    </div>

    <!-- Expenses section -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Expenses</h3>
        <div class="flex items-center gap-2">
          <button
            v-if="expenses?.length"
            class="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-1.5 text-xs font-medium text-sand-600 hover:bg-sand-50"
            title="Export as CSV"
            @click="downloadCsv(tripName, expenses ?? [], currencyCode)"
          >
            <Icon name="lucide:download" class="h-3 w-3" />
            <span class="hidden sm:inline">CSV</span>
          </button>
          <button
            class="inline-flex items-center gap-1 rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600"
            @click="
              () => {
                resetForm()
                showAddForm = !showAddForm
              }
            "
          >
            <Icon name="lucide:plus" class="h-3 w-3" />
            Add
          </button>
        </div>
      </div>

      <!-- Add/Edit form -->
      <form
        v-if="showAddForm"
        class="mt-4 space-y-3 border-b border-sand-100 pb-4"
        @submit.prevent="submitExpense"
      >
        <div>
          <label :for="descriptionId" class="mb-1 block text-xs font-medium text-sand-600">
            Description
          </label>
          <input
            :id="descriptionId"
            v-model="formDescription"
            type="text"
            placeholder="Description"
            required
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label :for="amountId" class="mb-1 block text-xs font-medium text-sand-600">
              Amount
            </label>
            <input
              :id="amountId"
              v-model="formAmount"
              type="number"
              step="0.01"
              placeholder="Amount"
              required
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
          <div>
            <label :for="categoryId" class="mb-1 block text-xs font-medium text-sand-600">
              Category
            </label>
            <select
              :id="categoryId"
              v-model="formCategory"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            >
              <option v-for="cat in categories" :key="cat" :value="cat">
                {{ cat }}
              </option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label :for="dateId" class="mb-1 block text-xs font-medium text-sand-600">Date</label>
            <input
              :id="dateId"
              v-model="formDate"
              type="date"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
          <div v-if="members && members.length > 1">
            <label :for="paidById" class="mb-1 block text-xs font-medium text-sand-600">
              Who paid?
            </label>
            <select
              :id="paidById"
              v-model="formPaidById"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            >
              <option value="">Who paid?</option>
              <option v-for="m in members" :key="m.userId" :value="m.userId">
                {{ m.user.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="min-h-11 rounded-lg border border-sand-300 px-3 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
            @click="
              () => {
                showAddForm = false
                resetForm()
              }
            "
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="submittingExpense"
            class="min-h-11 rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600 disabled:opacity-50"
          >
            {{ submittingExpense ? "Saving..." : editingExpenseId ? "Update" : "Add" }}
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
                :class="expenseCategoryBadgeClasses(expense.category)"
              >
                {{ formatType(expense.category) }}
              </span>
              <!-- Rendered from the date parts directly: <NuxtTime> resolves in
                   the viewer's timezone, which re-introduces the off-by-one. -->
              <span v-if="expense.paidAt">{{ formatCalendarDate(expense.paidAt) }}</span>
              <span v-if="expense.paidById && members && members.length > 1" class="text-sand-400">
                paid by {{ getMemberName(expense.paidById) }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-semibold text-sand-900 tabular-nums">
              {{ formatCurrency(parseFloat(expense.amount)) }}
            </span>
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 transition hover:text-terra-500 active:scale-95 focus-ring"
              title="Edit"
              aria-label="Edit expense"
              @click="startEdit(expense)"
            >
              <Icon name="lucide:edit" class="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 transition hover:text-red-500 active:scale-95 focus-ring"
              title="Delete"
              aria-label="Delete expense"
              @click="deleteExpense(expense.id)"
            >
              <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <p v-else class="mt-4 text-center text-xs text-sand-400">No expenses tracked yet.</p>
    </div>
  </div>
</template>
