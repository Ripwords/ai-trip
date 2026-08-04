<script setup lang="ts">
import {
  bookingOriginHint,
  editableBookingFields,
  isDerivedBooking,
  missingFieldsSummary,
  needsDetails,
  type BookingField,
  type BookingRow as Reservation,
} from "~/utils/booking-rows"

const props = defineProps<{
  tripId: string
  currencyCode: string
}>()

const emit = defineEmits<{
  "edit-in-itinerary": [dayId: string | null]
}>()

const { data: reservations, refresh } = await useFetch<Reservation[]>(
  `/api/trips/${props.tripId}/reservations`,
)

const showAddForm = ref(false)
const editingId = ref<string | null>(null)

// Which row is being edited, so the form can drop the fields the itinerary
// owns instead of re-asking for the hotel name and dates it already has.
const editingRow = computed(() => reservations.value?.find((r) => r.id === editingId.value) ?? null)
const formFields = computed<BookingField[]>(() =>
  editingRow.value
    ? editableBookingFields(editingRow.value)
    : editableBookingFields({ source: "manual", detachedAt: null }),
)
const editingDerived = computed(() => !!editingRow.value && isDerivedBooking(editingRow.value))
function shows(field: BookingField): boolean {
  return formFields.value.includes(field)
}

const uid = useId()
const nameId = `${uid}-name`
const confirmationId = `${uid}-confirmation`
const providerId = `${uid}-provider`

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
    // Only send what this row's card is allowed to own. A derived row that
    // posted its mirrored name or dates would be rejected with a 409 — those
    // belong to the stay, and the itinerary is where they're changed.
    const all: Record<BookingField, unknown> = {
      type: formType.value,
      status: formStatus.value,
      name: formName.value,
      confirmationNumber: formConfirmation.value || undefined,
      provider: formProvider.value || undefined,
      notes: formNotes.value || undefined,
      startDate: formStartDate.value ? new Date(formStartDate.value).toISOString() : undefined,
      endDate: formEndDate.value ? new Date(formEndDate.value).toISOString() : undefined,
      amount:
        formAmount.value === "" || formAmount.value == null ? undefined : String(formAmount.value),
    }
    const body: Record<string, unknown> = {}
    for (const field of formFields.value) {
      body[field] = all[field]
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

const { format: formatCurrencyRaw } = useCurrencyFormat(() => props.currencyCode)

function formatCurrency(amount: string): string {
  return formatCurrencyRaw(amount)
}

const showEndDate = computed(
  () => formType.value === "accommodation" || formType.value === "car_rental",
)

// Amount is always present; the two date inputs come and go with the row type
// and with whether this card owns its dates at all.
const dateGridClass = computed(() => {
  const columns = 1 + (shows("startDate") ? 1 : 0) + (shows("endDate") && showEndDate.value ? 1 : 0)
  return columns === 3 ? "grid-cols-3" : columns === 2 ? "grid-cols-2" : "grid-cols-1"
})
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
        <!--
          A derived row's hotel and nights come from the itinerary, so the form
          shows them as read-only context and sends the user back there to
          change them, rather than asking for them a second time.
        -->
        <div v-if="editingDerived && editingRow" class="rounded-xl bg-sand-50 px-3 py-2.5 text-sm">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-medium text-sand-900 truncate">{{ editingRow.name }}</p>
              <p v-if="editingRow.startDate" class="mt-0.5 text-xs text-sand-500">
                <NuxtTime
                  :datetime="editingRow.startDate"
                  locale="en-US"
                  month="short"
                  day="numeric"
                />
                <template v-if="editingRow.endDate">
                  –
                  <NuxtTime
                    :datetime="editingRow.endDate"
                    locale="en-US"
                    month="short"
                    day="numeric"
                  />
                </template>
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 text-xs font-medium text-terra-600 hover:text-terra-700 focus-ring"
              @click="emit('edit-in-itinerary', editingRow.itineraryDayId)"
            >
              Edit in itinerary →
            </button>
          </div>
          <p v-if="editingRow.missingFields.length" class="mt-2 text-xs text-sand-500">
            Just add the {{ missingFieldsSummary(editingRow.missingFields) }}.
          </p>
        </div>

        <div class="grid gap-3" :class="shows('type') ? 'grid-cols-2' : 'grid-cols-1'">
          <select
            v-if="shows('type')"
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
        <div v-if="shows('name')">
          <label :for="nameId" class="mb-1 block text-xs font-medium text-sand-600">Name</label>
          <input
            :id="nameId"
            v-model="formName"
            type="text"
            placeholder="Name (e.g. Tokyo to Osaka Shinkansen)"
            required
            class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label :for="confirmationId" class="mb-1 block text-xs font-medium text-sand-600">
              Confirmation number
            </label>
            <input
              :id="confirmationId"
              v-model="formConfirmation"
              type="text"
              placeholder="Confirmation # (optional)"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
            <p class="mt-1 text-xs text-sand-500">
              Visible to trip editors and the owner. Hidden from viewers.
            </p>
          </div>
          <div>
            <label :for="providerId" class="mb-1 block text-xs font-medium text-sand-600">
              Provider
            </label>
            <input
              :id="providerId"
              v-model="formProvider"
              type="text"
              placeholder="Provider (e.g. Booking.com)"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
        </div>
        <div class="grid gap-3" :class="dateGridClass">
          <div v-if="shows('startDate')">
            <label class="mb-1 block text-xs text-sand-500">{{
              showEndDate ? "Check-in" : "Date"
            }}</label>
            <input
              v-model="formStartDate"
              type="datetime-local"
              class="block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm input-focus"
            />
          </div>
          <div v-if="shows('endDate') && showEndDate">
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
                  <span
                    v-if="bookingOriginHint(r)"
                    class="inline-flex items-center gap-0.5 rounded-full bg-ocean-50 px-2 py-0.5 text-xs font-medium text-ocean-700"
                  >
                    <Icon name="lucide:link" class="h-3 w-3" />
                    {{ bookingOriginHint(r) }}
                  </span>
                  <span
                    v-if="needsDetails(r)"
                    class="inline-block rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700"
                  >
                    Needs details
                  </span>
                </div>
                <p v-if="needsDetails(r)" class="mt-1 text-xs text-sand-400">
                  Add the {{ missingFieldsSummary(r.missingFields) }} — the rest came from your
                  itinerary.
                </p>
                <div
                  v-if="r.startDate || r.confirmationNumber"
                  class="mt-1 flex flex-wrap items-center gap-2 text-xs text-sand-500"
                >
                  <span v-if="r.startDate" class="flex items-center gap-0.5">
                    <Icon name="lucide:calendar" class="h-3 w-3" />
                    <NuxtTime :datetime="r.startDate" locale="en-US" month="short" day="numeric" />
                    <template v-if="r.endDate">
                      to
                      <NuxtTime :datetime="r.endDate" locale="en-US" month="short" day="numeric"
                    /></template>
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
              <span v-if="r.amount" class="text-sm font-semibold text-sand-900 tabular-nums">
                {{ formatCurrency(r.amount) }}
              </span>
              <button
                type="button"
                class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 transition hover:text-terra-500 active:scale-95 focus-ring"
                title="Edit"
                aria-label="Edit reservation"
                @click="startEdit(r)"
              >
                <Icon name="lucide:edit" class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sand-500 transition hover:text-red-500 active:scale-95 focus-ring"
                title="Delete"
                aria-label="Delete reservation"
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
