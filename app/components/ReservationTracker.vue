<script setup lang="ts">
interface Reservation {
  id: string
  type: string
  status: string
  name: string
  confirmationNumber: string | null
  provider: string | null
  notes: string | null
  startDate: string | null
  endDate: string | null
  amount: string | null
}

const props = defineProps<{
  tripId: string
  currencyCode: string
}>()

const { data: reservations, refresh } = await useFetch<Reservation[]>(
  `/api/trips/${props.tripId}/reservations`,
)

const showAddForm = ref(false)
const editingId = ref<string | null>(null)

// Form fields
const formType = ref("flight")
const formStatus = ref("confirmed")
const formName = ref("")
const formConfirmation = ref("")
const formProvider = ref("")
const formNotes = ref("")
const formStartDate = ref("")
const formEndDate = ref("")
const formAmount = ref("")

const types = [
  "flight",
  "accommodation",
  "restaurant",
  "car_rental",
  "activity",
  "transport",
  "other",
] as const

const statuses = ["confirmed", "pending", "cancelled"] as const

const typeIcons: Record<string, string> = {
  flight: "lucide:plane",
  accommodation: "lucide:bed-double",
  restaurant: "lucide:utensils",
  car_rental: "lucide:car",
  activity: "lucide:ticket",
  transport: "lucide:bus",
  other: "lucide:package",
}

const statusClasses: Record<string, string> = {
  confirmed: "bg-forest-50 text-forest-700",
  pending: "bg-yellow-50 text-yellow-700",
  cancelled: "bg-red-50 text-red-600",
}

function resetForm() {
  formType.value = "flight"
  formStatus.value = "confirmed"
  formName.value = ""
  formConfirmation.value = ""
  formProvider.value = ""
  formNotes.value = ""
  formStartDate.value = ""
  formEndDate.value = ""
  formAmount.value = ""
  editingId.value = null
}

function startEdit(r: Reservation) {
  editingId.value = r.id
  formType.value = r.type
  formStatus.value = r.status
  formName.value = r.name
  formConfirmation.value = r.confirmationNumber ?? ""
  formProvider.value = r.provider ?? ""
  formNotes.value = r.notes ?? ""
  formStartDate.value = r.startDate ? new Date(r.startDate).toISOString().slice(0, 16) : ""
  formEndDate.value = r.endDate ? new Date(r.endDate).toISOString().slice(0, 16) : ""
  formAmount.value = r.amount ?? ""
  showAddForm.value = true
}

async function submitReservation() {
  if (!formName.value.trim()) return
  try {
    const body: Record<string, unknown> = {
      type: formType.value,
      status: formStatus.value,
      name: formName.value,
      confirmationNumber: formConfirmation.value || undefined,
      provider: formProvider.value || undefined,
      notes: formNotes.value || undefined,
      startDate: formStartDate.value ? new Date(formStartDate.value).toISOString() : undefined,
      endDate: formEndDate.value ? new Date(formEndDate.value).toISOString() : undefined,
      amount: formAmount.value || undefined,
    }

    if (editingId.value) {
      await $fetch(`/api/trips/${props.tripId}/reservations/${editingId.value}`, {
        method: "PUT",
        body,
      })
    } else {
      await $fetch(`/api/trips/${props.tripId}/reservations`, {
        method: "POST",
        body,
      })
    }
    resetForm()
    showAddForm.value = false
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to save reservation:", e)
  }
}

const { confirm } = useConfirm()

async function deleteReservation(id: string) {
  const ok = await confirm({
    title: "Delete reservation",
    message: "Delete this reservation? This cannot be undone.",
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  try {
    await $fetch(`/api/trips/${props.tripId}/reservations/${id}`, {
      method: "DELETE",
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete reservation:", e)
  }
}

function formatCurrency(amount: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: props.currencyCode || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(parseFloat(amount))
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

const showEndDate = computed(
  () => formType.value === "accommodation" || formType.value === "car_rental",
)
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-sand-900">Reservations</h3>
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

      <!-- Add/Edit form -->
      <form
        v-if="showAddForm"
        class="mt-4 space-y-3 border-b border-sand-100 pb-4"
        @submit.prevent="submitReservation"
      >
        <div class="grid grid-cols-2 gap-3">
          <select
            v-model="formType"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          >
            <option v-for="t in types" :key="t" :value="t">
              {{ formatType(t) }}
            </option>
          </select>
          <select
            v-model="formStatus"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          >
            <option v-for="s in statuses" :key="s" :value="s">
              {{ formatType(s) }}
            </option>
          </select>
        </div>
        <input
          v-model="formName"
          type="text"
          placeholder="Name (e.g. Tokyo → Osaka Shinkansen)"
          required
          class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
        />
        <div class="grid grid-cols-2 gap-3">
          <input
            v-model="formConfirmation"
            type="text"
            placeholder="Confirmation #"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
          <input
            v-model="formProvider"
            type="text"
            placeholder="Provider (e.g. Booking.com)"
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
        </div>
        <div class="grid gap-3" :class="showEndDate ? 'grid-cols-3' : 'grid-cols-2'">
          <div>
            <label class="mb-1 block text-xs text-sand-500">{{
              showEndDate ? "Check-in" : "Date"
            }}</label>
            <input
              v-model="formStartDate"
              type="datetime-local"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
          <div v-if="showEndDate">
            <label class="mb-1 block text-xs text-sand-500">Check-out</label>
            <input
              v-model="formEndDate"
              type="datetime-local"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-sand-500">Amount</label>
            <input
              v-model="formAmount"
              type="number"
              step="0.01"
              placeholder="0.00"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
        </div>
        <textarea
          v-model="formNotes"
          rows="2"
          placeholder="Notes (optional)"
          class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
        />
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-sand-300 px-3 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
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
            class="rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white hover:bg-terra-600"
          >
            {{ editingId ? "Update" : "Add" }}
          </button>
        </div>
      </form>

      <!-- Reservation list -->
      <div v-if="reservations?.length" class="mt-4 space-y-2">
        <div
          v-for="r in reservations"
          :key="r.id"
          class="rounded-xl border border-sand-200 px-3 py-2.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-start gap-2 min-w-0">
              <Icon
                :name="typeIcons[r.type] || 'lucide:package'"
                class="mt-0.5 h-4 w-4 shrink-0 text-sand-500"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium text-sand-900 truncate">{{ r.name }}</p>
                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-sand-500">
                  <span
                    class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="statusClasses[r.status] || 'bg-sand-100 text-sand-700'"
                  >
                    {{ formatType(r.status) }}
                  </span>
                  <span
                    class="inline-block rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-600"
                  >
                    {{ formatType(r.type) }}
                  </span>
                  <span v-if="r.provider" class="text-sand-400">{{ r.provider }}</span>
                </div>
                <div
                  v-if="r.startDate || r.confirmationNumber"
                  class="mt-1 flex flex-wrap items-center gap-2 text-xs text-sand-500"
                >
                  <span v-if="r.startDate" class="flex items-center gap-0.5">
                    <Icon name="lucide:calendar" class="h-3 w-3" />
                    {{ formatDateShort(r.startDate) }}
                    <template v-if="r.endDate"> &ndash; {{ formatDateShort(r.endDate) }}</template>
                  </span>
                  <span
                    v-if="r.confirmationNumber"
                    class="flex items-center gap-0.5 font-mono text-sand-400"
                  >
                    <Icon name="lucide:hash" class="h-3 w-3" />
                    {{ r.confirmationNumber }}
                  </span>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span v-if="r.amount" class="text-sm font-semibold text-sand-900">
                {{ formatCurrency(r.amount) }}
              </span>
              <button
                class="rounded p-1 text-sand-300 hover:text-terra-500"
                title="Edit"
                @click="startEdit(r)"
              >
                <Icon name="lucide:edit" class="h-3.5 w-3.5" />
              </button>
              <button
                class="rounded p-1 text-sand-300 hover:text-red-500"
                title="Delete"
                @click="deleteReservation(r.id)"
              >
                <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p v-if="r.notes" class="mt-1.5 ml-6 text-xs text-sand-400 italic">{{ r.notes }}</p>
        </div>
      </div>

      <p v-else class="mt-4 text-center text-xs text-sand-400">
        No reservations yet. Add flights, hotels, and other bookings.
      </p>
    </div>
  </div>
</template>
