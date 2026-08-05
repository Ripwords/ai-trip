<script setup lang="ts">
import type { TripExpenseSummary } from "#shared/utils/expense-summary"
import type {
  ExpenseListParams,
  ExpenseSortField,
  ExpenseSortOrder,
} from "#shared/utils/expense-list"
import { SPLIT_MODES, type SplitMode } from "#shared/utils/splits"

/** Receipt metadata as the list endpoint embeds it (#48). Never the storage key. */
interface ExpenseReceipt {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
}

interface Expense {
  id: string
  description: string
  /** Denominated in the trip's currency. */
  amount: string
  category: string
  activityId: string | null
  paidById: string | null
  paidAt: string | null
  splitMode: string
  /** Resolved per-participant amounts; null means "equal across everyone". */
  splits: Record<string, string> | null
  attachments: ExpenseReceipt[]
}

interface ExpenseActivity {
  id: string
  name: string
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
  /**
   * Owned by the page so the Overview tab and this tracker read the same list.
   * This component used to run its own useFetch, which meant a second request
   * for the same endpoint and an Overview that went stale after every edit.
   */
  expenses: Expense[]
  /**
   * Server-computed totals, budget, breakdowns and settlement (#38). This
   * component used to add the expense list up itself, and its answer differed
   * from both TripOverview's and TripStats'.
   */
  summary: TripExpenseSummary | null
  /** For linking an expense to a planned activity (#39). */
  activities?: ExpenseActivity[]
  /**
   * Server-side filter/sort state (#49). The rows in `expenses` are the pages
   * fetched under these parameters, so the controls below change the query
   * rather than filtering an array the browser already downloaded.
   */
  filters: ExpenseListParams
  /** Rows matching the filter across every page, and their sum. */
  filteredCount: number
  filteredTotal: number
  /** Whether another page exists. */
  hasMore: boolean
  loadingMore?: boolean
}>()

const emit = defineEmits<{
  budgetUpdated: []
  expensesChanged: []
  "update:filters": [ExpenseListParams]
  loadMore: []
  exportCsv: []
}>()

const expenses = computed(() => props.expenses)
/** Ask the page to refetch; it owns the data. Fire-and-forget by design. */
const refresh = () => emit("expensesChanged")

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
const activityFieldId = `${uid}-activity`
const splitModeId = `${uid}-split-mode`
const filterCategoryId = `${uid}-filter-category`
const filterPayerId = `${uid}-filter-payer`
const filterFromId = `${uid}-filter-from`
const filterToId = `${uid}-filter-to`
const filterSortId = `${uid}-filter-sort`

const EMPTY_FILTERS: ExpenseListParams = {
  category: "",
  payerId: "",
  from: "",
  to: "",
  sort: "createdAt",
  order: "desc",
  limit: String(EXPENSE_PAGE_SIZE_DEFAULT),
}

function setFilter<K extends keyof ExpenseListParams>(key: K, value: ExpenseListParams[K]) {
  emit("update:filters", { ...props.filters, [key]: value })
}

/** The sort control is one `<select>` over the (field, order) pair. */
const sortValue = computed({
  get: () => `${props.filters.sort}:${props.filters.order}`,
  set: (value: string) => {
    const [sort, order] = value.split(":") as [ExpenseSortField, ExpenseSortOrder]
    emit("update:filters", { ...props.filters, sort, order })
  },
})

const sortOptions: { value: string; label: string }[] = [
  { value: "createdAt:desc", label: "Recently added" },
  { value: "createdAt:asc", label: "Oldest added" },
  { value: "paidAt:desc", label: "Date — newest" },
  { value: "paidAt:asc", label: "Date — oldest" },
  { value: "amount:desc", label: "Amount — highest" },
  { value: "amount:asc", label: "Amount — lowest" },
]

const filtersActive = computed(
  () =>
    Boolean(props.filters.category) ||
    Boolean(props.filters.payerId) ||
    Boolean(props.filters.from) ||
    Boolean(props.filters.to),
)

function clearFilters() {
  emit("update:filters", { ...EMPTY_FILTERS, sort: props.filters.sort, order: props.filters.order })
}

// ---------------------------------------------------------------------------
// Receipts (#48)
// ---------------------------------------------------------------------------

const receiptInput = ref<HTMLInputElement | null>(null)
const uploadingFor = ref<string | null>(null)
/** The receipt open in the lightbox, if any. */
const openReceipt = ref<ExpenseReceipt | null>(null)
/** Which expense the hidden file input is currently acting for. */
const receiptTargetExpenseId = ref<string | null>(null)

const receiptAccept = RECEIPT_ALLOWED_MIME_TYPES.join(",")

function isImageReceipt(receipt: ExpenseReceipt): boolean {
  return receipt.mimeType.startsWith("image/")
}

function chooseReceipt(expenseId: string) {
  receiptTargetExpenseId.value = expenseId
  receiptInput.value?.click()
}

async function onReceiptChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const expenseId = receiptTargetExpenseId.value
  // Reset immediately: without this, picking the same file twice in a row fires
  // no `change` event and the upload silently does not happen.
  input.value = ""
  if (!file || !expenseId) return

  // The server enforces this too, on the bytes rather than on a claim — this is
  // only so an obvious mistake does not cost an upload.
  if (file.size > RECEIPT_MAX_BYTES) {
    toast.error(`Receipts must be ${RECEIPT_MAX_MB} MB or smaller.`)
    return
  }

  uploadingFor.value = expenseId
  try {
    const body = new FormData()
    body.append("file", file)
    await $fetch(`/api/trips/${props.tripId}/expenses/${expenseId}/attachments`, {
      method: "POST",
      body,
    })
    refresh()
  } catch (e: unknown) {
    console.error("Failed to upload receipt:", e)
    toast.error("Couldn't attach that receipt. JPEG, PNG, WebP and PDF are supported.")
  } finally {
    uploadingFor.value = null
    receiptTargetExpenseId.value = null
  }
}

/** The lightbox knows the receipt; the endpoint needs the expense too. */
function deleteOpenReceipt() {
  const receipt = openReceipt.value
  if (!receipt) return
  const owner = props.expenses.find((e) => e.attachments.some((a) => a.id === receipt.id))
  if (owner) void deleteReceipt(owner.id, receipt)
}

async function deleteReceipt(expenseId: string, receipt: ExpenseReceipt) {
  const ok = await confirm({
    title: "Delete receipt",
    message: `Delete ${receipt.fileName}? This cannot be undone.`,
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/trips/${props.tripId}/expenses/${expenseId}/attachments/${receipt.id}`, {
      method: "DELETE",
    })
    openReceipt.value = null
    refresh()
  } catch (e: unknown) {
    console.error("Failed to delete receipt:", e)
    toast.error("Couldn't delete that receipt. Please try again.")
  }
}

// Form fields
const formDescription = ref("")
const formAmount = ref("")
const formCategory = ref("food")
const formDate = ref(todayCalendarDate())
const formPaidById = ref<string>("")
const formActivityId = ref<string>("")
const formSplitMode = ref<SplitMode>("equal")
/** Empty = everyone on the trip, which is stored as a NULL `splits`. */
const formParticipantIds = ref<string[]>([])
const formSplitValues = ref<Record<string, string>>({})

// Both come from shared/utils/expense-categories.ts — the same list the server
// validates against, so the picker can't fall out of sync with the enum.
const categories = EXPENSE_CATEGORIES
const splitModes = SPLIT_MODES

const splitModeLabels: Record<SplitMode, string> = {
  equal: "Split equally",
  exact: "Exact amounts",
  shares: "By shares",
  percent: "By percentage",
}

// Every number below is server-computed (#38). This component used to derive
// its own total from `expenses`, TripOverview derived a second one, and
// TripStats a third from a different column entirely.
const totalExpenses = computed(() => props.summary?.total ?? 0)
const budgetNum = computed(() => props.summary?.budget ?? null)
const budgetPercent = computed(() => props.summary?.budgetPercent ?? 0)

const progressBarColor = computed(() => {
  if (budgetPercent.value >= 100) return "bg-red-600"
  if (budgetPercent.value >= 80) return "bg-amber-500"
  return "bg-forest-500"
})

const settlement = computed(() => props.summary?.settlement.balances ?? [])
// Who pays whom (#36) — balances alone left the group doing this by hand.
const transfers = computed(() => props.summary?.settlement.transfers ?? [])
const unattributedTotal = computed(() => props.summary?.settlement.unattributedTotal ?? 0)
/** Planned estimate vs actual spend per activity (#39). */
const plannedVsActual = computed(() => props.summary?.plannedVsActual ?? [])
/** The people a split may name. */
const splittableMembers = computed(() => props.members ?? [])
const canSplit = computed(() => splittableMembers.value.length > 1)

function toggleParticipant(userId: string) {
  const current = formParticipantIds.value
  formParticipantIds.value = current.includes(userId)
    ? current.filter((id) => id !== userId)
    : [...current, userId]
}

function activityName(activityId: string | null): string {
  if (!activityId) return ""
  return props.activities?.find((a) => a.id === activityId)?.name ?? ""
}

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
  formActivityId.value = ""
  formSplitMode.value = "equal"
  formParticipantIds.value = []
  formSplitValues.value = {}
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
  formActivityId.value = expense.activityId ?? ""
  // Stored splits are resolved amounts, so `exact` round-trips them exactly and
  // any other mode's original weights are not recoverable — the resolved
  // amounts are, and they mean the same thing.
  if (expense.splits) {
    formSplitMode.value = "exact"
    formParticipantIds.value = Object.keys(expense.splits)
    formSplitValues.value = { ...expense.splits }
  } else {
    formSplitMode.value = "equal"
    formParticipantIds.value = []
    formSplitValues.value = {}
  }
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
      activityId: formActivityId.value || null,
    }

    // Omitting the participant list means "everyone on the trip", which the
    // server stores as a NULL `splits` so the expense keeps following the
    // roster. Only send a split when the user actually narrowed it.
    if (canSplit.value && formParticipantIds.value.length > 0) {
      body.splitMode = formSplitMode.value
      body.participantIds = formParticipantIds.value
      if (formSplitMode.value !== "equal") {
        body.splitValues = Object.fromEntries(
          formParticipantIds.value.map((id) => [id, Number(formSplitValues.value[id] ?? 0)]),
        )
      }
    } else if (editingExpenseId.value) {
      // Clearing the participants on an edit has to actively reset the stored
      // split, or the old one silently survives against the new amount.
      body.splitMode = "equal"
      body.participantIds = []
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
    refresh()
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
    refresh()
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

      <!-- Who pays whom. Balances alone left the group working the transfers
           out by hand, which is the chore this feature exists to remove. -->
      <div v-if="transfers.length > 0" class="mt-3 space-y-2">
        <p class="text-xs font-medium uppercase tracking-wide text-sand-500">Settle up</p>
        <div
          v-for="t in transfers"
          :key="`${t.fromUserId}-${t.toUserId}`"
          class="flex items-center justify-between rounded-xl bg-sand-50 px-3 py-2 text-sm"
        >
          <span class="text-sand-700">
            <span class="font-medium text-sand-900">{{ t.fromName }}</span>
            pays
            <span class="font-medium text-sand-900">{{ t.toName }}</span>
          </span>
          <span class="font-semibold tabular-nums text-sand-900">
            {{ formatCurrency(t.amount) }}
          </span>
        </div>
      </div>

      <p
        v-if="settlement.length > 0"
        class="mt-4 text-xs font-medium uppercase tracking-wide text-sand-500"
      >
        Balances
      </p>
      <div v-if="settlement.length > 0" class="mt-2 space-y-2">
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

    <!-- Planned vs actual. `expenses.activityId` had a column, an index and a
         relation, and nothing in the UI ever set or read it. -->
    <div v-if="plannedVsActual.length > 0" class="rounded-2xl border border-sand-200 bg-white p-6">
      <h3 class="text-sm font-semibold text-sand-900">Planned vs actual</h3>
      <div class="mt-3 space-y-2">
        <div
          v-for="row in plannedVsActual"
          :key="row.activityId"
          class="flex items-center justify-between gap-3 text-sm"
        >
          <div class="min-w-0">
            <p class="truncate text-sand-800">{{ row.name }}</p>
            <p class="text-xs text-sand-500">Day {{ row.dayNumber }}</p>
          </div>
          <div class="shrink-0 text-right tabular-nums">
            <p class="text-sand-600 text-xs">
              est. {{ formatCurrency(row.planned) }} · actual
              {{ formatCurrency(row.actual) }}
            </p>
            <p
              class="text-xs font-medium"
              :class="row.variance > 0 ? 'text-terra-600' : 'text-forest-600'"
            >
              {{ row.variance > 0 ? "+" : "" }}{{ formatCurrency(row.variance) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Expenses section -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Expenses</h3>
        <div class="flex items-center gap-2">
          <button
            v-if="filteredCount > 0"
            class="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-1.5 text-xs font-medium text-sand-600 hover:bg-sand-50"
            title="Export as CSV"
            @click="emit('exportCsv')"
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

      <!-- Filter / sort bar (#49). Every control below is a query parameter on
           the list endpoint; nothing here filters an array in the browser. -->
      <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <label :for="filterCategoryId" class="mb-1 block text-xs font-medium text-sand-600">
            Category
          </label>
          <select
            :id="filterCategoryId"
            :value="filters.category"
            class="block w-full rounded-lg border border-sand-300 px-2 py-1.5 text-xs input-focus"
            @change="setFilter('category', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">All categories</option>
            <option v-for="cat in categories" :key="cat" :value="cat">
              {{ formatType(cat) }}
            </option>
          </select>
        </div>

        <div v-if="members && members.length > 1">
          <label :for="filterPayerId" class="mb-1 block text-xs font-medium text-sand-600">
            Paid by
          </label>
          <select
            :id="filterPayerId"
            :value="filters.payerId"
            class="block w-full rounded-lg border border-sand-300 px-2 py-1.5 text-xs input-focus"
            @change="setFilter('payerId', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Anyone</option>
            <option v-for="m in members" :key="m.userId" :value="m.userId">
              {{ m.user.name }}
            </option>
            <option value="none">No payer recorded</option>
          </select>
        </div>

        <div>
          <label :for="filterSortId" class="mb-1 block text-xs font-medium text-sand-600">
            Sort
          </label>
          <select
            :id="filterSortId"
            v-model="sortValue"
            class="block w-full rounded-lg border border-sand-300 px-2 py-1.5 text-xs input-focus"
          >
            <option v-for="option in sortOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <label :for="filterFromId" class="mb-1 block text-xs font-medium text-sand-600">
            From
          </label>
          <input
            :id="filterFromId"
            :value="filters.from"
            type="date"
            class="block w-full rounded-lg border border-sand-300 px-2 py-1.5 text-xs input-focus"
            @change="setFilter('from', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div>
          <label :for="filterToId" class="mb-1 block text-xs font-medium text-sand-600">To</label>
          <input
            :id="filterToId"
            :value="filters.to"
            type="date"
            class="block w-full rounded-lg border border-sand-300 px-2 py-1.5 text-xs input-focus"
            @change="setFilter('to', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div v-if="filtersActive" class="flex items-end">
          <button
            type="button"
            class="min-h-9 w-full rounded-lg border border-sand-300 px-2 py-1.5 text-xs font-medium text-sand-700 hover:bg-sand-50"
            @click="clearFilters"
          >
            Clear filters
          </button>
        </div>
      </div>

      <!-- What the filter selected. The trip's own total stays above, server
           computed and unfiltered — a budget or settlement derived from a
           subset of the expenses would be wrong, not merely narrower. -->
      <p v-if="filtersActive" class="mt-2 text-xs text-sand-500 tabular-nums">
        {{ filteredCount }} matching {{ filteredCount === 1 ? "expense" : "expenses" }} ·
        {{ formatCurrency(filteredTotal) }}
        <span class="text-sand-400">(trip total above is unfiltered)</span>
      </p>

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
        <div class="grid grid-cols-3 gap-3">
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
        <!-- Link to a planned activity so estimate and actual can meet (#39). -->
        <div v-if="activities && activities.length > 0">
          <label :for="activityFieldId" class="mb-1 block text-xs font-medium text-sand-600">
            Activity (optional)
          </label>
          <select
            :id="activityFieldId"
            v-model="formActivityId"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          >
            <option value="">Not linked to an activity</option>
            <option v-for="a in activities" :key="a.id" :value="a.id">
              {{ a.name }}
            </option>
          </select>
        </div>

        <!-- Who actually shared this. Leaving it untouched means everyone,
             which is what the tracker used to assume unconditionally (#35). -->
        <div v-if="canSplit" class="rounded-xl border border-sand-200 p-3">
          <label :for="splitModeId" class="mb-1 block text-xs font-medium text-sand-600">
            Split
          </label>
          <select
            :id="splitModeId"
            v-model="formSplitMode"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          >
            <option v-for="mode in splitModes" :key="mode" :value="mode">
              {{ splitModeLabels[mode] }}
            </option>
          </select>

          <p class="mt-2 text-xs text-sand-500">
            {{
              formParticipantIds.length === 0
                ? "Shared by everyone on the trip."
                : `Shared by ${formParticipantIds.length} of ${splittableMembers.length}.`
            }}
          </p>

          <div class="mt-2 space-y-1.5">
            <div
              v-for="m in splittableMembers"
              :key="m.userId"
              class="flex items-center justify-between gap-2"
            >
              <label class="flex min-w-0 items-center gap-2 text-sm text-sand-700">
                <input
                  type="checkbox"
                  :checked="formParticipantIds.includes(m.userId)"
                  class="h-4 w-4 rounded border-sand-300"
                  @change="toggleParticipant(m.userId)"
                />
                <span class="truncate">{{ m.user.name }}</span>
              </label>
              <input
                v-if="formSplitMode !== 'equal' && formParticipantIds.includes(m.userId)"
                v-model="formSplitValues[m.userId]"
                type="number"
                step="0.01"
                min="0"
                :placeholder="
                  formSplitMode === 'percent'
                    ? '%'
                    : formSplitMode === 'shares'
                      ? 'shares'
                      : 'amount'
                "
                class="w-24 shrink-0 rounded-lg border border-sand-300 px-2 py-1 text-sm input-focus"
              />
            </div>
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
          class="rounded-xl border border-sand-200 px-3 py-2"
        >
          <div class="flex items-center justify-between">
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
                <span
                  v-if="expense.paidById && members && members.length > 1"
                  class="text-sand-400"
                >
                  paid by {{ getMemberName(expense.paidById) }}
                </span>
                <span v-if="expense.activityId" class="text-sand-400">
                  · {{ activityName(expense.activityId) }}
                </span>
                <span v-if="expense.splits" class="text-sand-400">
                  · split {{ Object.keys(expense.splits).length }} ways
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

          <!-- Receipts (#48). Served from our own origin and gated on trip
               membership — never from the public share link. -->
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
              v-for="receipt in expense.attachments"
              :key="receipt.id"
              type="button"
              class="group relative overflow-hidden rounded-lg border border-sand-200 focus-ring"
              :title="receipt.fileName"
              :aria-label="`Open receipt ${receipt.fileName}`"
              @click="openReceipt = receipt"
            >
              <img
                v-if="isImageReceipt(receipt)"
                :src="receipt.url"
                :alt="receipt.fileName"
                class="h-10 w-10 object-cover"
                loading="lazy"
              />
              <span
                v-else
                class="flex h-10 w-14 items-center justify-center gap-1 bg-sand-50 text-[10px] font-medium text-sand-600"
              >
                <Icon name="lucide:file-text" class="h-3.5 w-3.5" />
                PDF
              </span>
            </button>

            <button
              type="button"
              :disabled="uploadingFor === expense.id"
              class="inline-flex min-h-9 items-center gap-1 rounded-lg border border-dashed border-sand-300 px-2 py-1.5 text-xs font-medium text-sand-500 hover:bg-sand-50 disabled:opacity-50"
              @click="chooseReceipt(expense.id)"
            >
              <Icon name="lucide:paperclip" class="h-3 w-3" />
              {{ uploadingFor === expense.id ? "Uploading…" : "Receipt" }}
            </button>
          </div>
        </div>
      </div>

      <p v-else class="mt-4 text-center text-xs text-sand-400">
        {{ filtersActive ? "No expenses match these filters." : "No expenses tracked yet." }}
      </p>

      <!-- One input for the whole list; `chooseReceipt` records which row it
           is acting for. -->
      <input
        ref="receiptInput"
        type="file"
        class="hidden"
        :accept="receiptAccept"
        @change="onReceiptChosen"
      />

      <!-- Receipt lightbox. A PDF is not embedded: it opens in its own tab,
           where the browser's own viewer handles it. -->
      <div
        v-if="openReceipt"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        :aria-label="openReceipt.fileName"
        @click.self="openReceipt = null"
        @keydown.esc="openReceipt = null"
      >
        <div class="max-h-full w-full max-w-2xl overflow-auto rounded-2xl bg-white p-4">
          <div class="flex items-start justify-between gap-3">
            <p class="min-w-0 truncate text-sm font-medium text-sand-900">
              {{ openReceipt.fileName }}
            </p>
            <button
              type="button"
              class="min-h-9 min-w-9 shrink-0 rounded text-sand-500 hover:text-sand-800 focus-ring"
              aria-label="Close receipt"
              @click="openReceipt = null"
            >
              <Icon name="lucide:x" class="h-4 w-4" />
            </button>
          </div>

          <img
            v-if="isImageReceipt(openReceipt)"
            :src="openReceipt.url"
            :alt="openReceipt.fileName"
            class="mt-3 max-h-[70vh] w-full rounded-lg object-contain"
          />
          <a
            v-else
            :href="openReceipt.url"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-flex items-center gap-1 rounded-lg border border-sand-300 px-3 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
          >
            <Icon name="lucide:download" class="h-4 w-4" />
            Download {{ openReceipt.fileName }}
          </a>

          <div class="mt-4 flex justify-end">
            <button
              type="button"
              class="min-h-9 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              @click="deleteOpenReceipt"
            >
              Delete receipt
            </button>
          </div>
        </div>
      </div>

      <!-- Cursor pagination (#49): the rows above are one page, not the trip. -->
      <div v-if="hasMore" class="mt-3 text-center">
        <button
          type="button"
          :disabled="loadingMore"
          class="min-h-11 rounded-lg border border-sand-300 px-4 py-2 text-xs font-medium text-sand-700 hover:bg-sand-50 disabled:opacity-50"
          @click="emit('loadMore')"
        >
          {{ loadingMore ? "Loading…" : `Load more (${filteredCount - expenses.length} left)` }}
        </button>
      </div>
    </div>
  </div>
</template>
