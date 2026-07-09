<script setup lang="ts">
import { countries, countryFlag } from "../data/countries"

interface Passport {
  id: string
  countryCode: string
  label: string | null
  passportNumber: string | null
  expiryDate: string | null
  isDefault: boolean
}

const { data: passports, refresh } = await useFetch<Passport[]>("/api/user/passports")

// Add form field ids for label association
const countryFieldId = useId()
const numberFieldId = useId()
const expiryFieldId = useId()

// Add form state
const newCountryCode = ref("")
const newPassportNumber = ref("")
const newExpiryDate = ref("")
const adding = ref(false)

// Edit state
const editingId = ref<string | null>(null)
const editPassportNumber = ref("")
const editExpiryDate = ref("")
const savingEdit = ref(false)

// Visibility toggle for passport numbers
const visibleNumbers = ref<Set<string>>(new Set())

const countryOptions = computed(() =>
  countries
    .map((c) => ({ value: c.alpha2, label: `${countryFlag(c.alpha2)} ${c.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
)

function countryName(code: string): string {
  return countries.find((c) => c.alpha2 === code)?.name ?? code
}

function maskPassportNumber(num: string): string {
  if (num.length <= 4) return "****"
  return "•".repeat(num.length - 4) + num.slice(-4)
}

function toggleVisibility(id: string) {
  if (visibleNumbers.value.has(id)) {
    visibleNumbers.value.delete(id)
  } else {
    visibleNumbers.value.add(id)
  }
}

function startEditing(passport: Passport) {
  editingId.value = passport.id
  editPassportNumber.value = passport.passportNumber ?? ""
  editExpiryDate.value = passport.expiryDate ?? ""
}

function cancelEditing() {
  editingId.value = null
}

async function saveEdit(id: string) {
  savingEdit.value = true
  try {
    await $fetch(`/api/user/passports/${id}`, {
      method: "PATCH",
      body: {
        passportNumber: editPassportNumber.value || null,
        expiryDate: editExpiryDate.value || null,
      },
    })
    editingId.value = null
    await refresh()
  } finally {
    savingEdit.value = false
  }
}

async function addPassport() {
  if (!newCountryCode.value) return
  adding.value = true
  try {
    await $fetch("/api/user/passports", {
      method: "POST",
      body: {
        countryCode: newCountryCode.value,
        passportNumber: newPassportNumber.value || null,
        expiryDate: newExpiryDate.value || null,
      },
    })
    newCountryCode.value = ""
    newPassportNumber.value = ""
    newExpiryDate.value = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to add passport:", e)
  } finally {
    adding.value = false
  }
}

async function setDefault(id: string) {
  await $fetch(`/api/user/passports/${id}`, {
    method: "PATCH",
    body: { isDefault: true },
  })
  await refresh()
}

const { confirm } = useConfirm()

async function removePassport(id: string) {
  const ok = await confirm({
    title: "Remove passport",
    message: "Are you sure you want to remove this passport?",
    confirmText: "Remove",
    destructive: true,
  })
  if (!ok) return
  await $fetch(`/api/user/passports/${id}`, { method: "DELETE" })
  await refresh()
}

function isExpiringSoon(date: string): boolean {
  const expiry = new Date(date)
  const sixMonths = new Date()
  sixMonths.setMonth(sixMonths.getMonth() + 6)
  return expiry <= sixMonths
}
</script>

<template>
  <div class="space-y-4">
    <!-- Existing passports -->
    <div v-if="passports?.length" class="space-y-3">
      <div
        v-for="passport in passports"
        :key="passport.id"
        class="rounded-xl border border-sand-200 p-4"
      >
        <!-- View mode -->
        <template v-if="editingId !== passport.id">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sand-900">
                  {{ countryFlag(passport.countryCode) }} {{ countryName(passport.countryCode) }}
                </span>
                <span class="text-xs text-sand-600">{{ passport.countryCode }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                <span v-if="passport.passportNumber" class="flex items-center gap-1 text-sand-600">
                  <Icon name="lucide:hash" class="h-3 w-3 text-sand-600" />
                  <span class="font-mono">
                    {{
                      visibleNumbers.has(passport.id)
                        ? passport.passportNumber
                        : maskPassportNumber(passport.passportNumber)
                    }}
                  </span>
                  <button
                    type="button"
                    :aria-label="
                      visibleNumbers.has(passport.id)
                        ? 'Hide passport number'
                        : 'Show passport number'
                    "
                    class="focus-ring -my-2 ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-600 hover:text-sand-900"
                    @click="toggleVisibility(passport.id)"
                  >
                    <Icon
                      :name="visibleNumbers.has(passport.id) ? 'lucide:eye-off' : 'lucide:eye'"
                      class="h-3 w-3"
                    />
                  </button>
                </span>
                <span
                  v-if="passport.expiryDate"
                  class="flex items-center gap-1"
                  :class="isExpiringSoon(passport.expiryDate) ? 'text-red-600' : 'text-sand-600'"
                >
                  <Icon name="lucide:calendar" class="h-3 w-3" />
                  Exp
                  <NuxtTime
                    :datetime="passport.expiryDate + 'T00:00:00'"
                    locale="en-US"
                    month="short"
                    year="numeric"
                  />
                  <span
                    v-if="isExpiringSoon(passport.expiryDate)"
                    class="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600"
                  >
                    Expiring soon
                  </span>
                </span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Edit passport"
                class="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 hover:bg-sand-50 hover:text-sand-700"
                @click="startEditing(passport)"
              >
                <Icon name="lucide:pencil" class="h-3.5 w-3.5" />
              </button>
              <button
                v-if="!passport.isDefault"
                type="button"
                aria-label="Set as default"
                class="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 hover:bg-sand-50 hover:text-terra-500"
                @click="setDefault(passport.id)"
              >
                <Icon name="lucide:star" class="h-3.5 w-3.5" />
              </button>
              <div
                v-else
                class="inline-flex min-h-11 min-w-11 items-center justify-center"
                aria-label="Default passport"
                role="img"
              >
                <Icon name="lucide:star" class="h-3.5 w-3.5 text-terra-500" />
              </div>
              <button
                type="button"
                aria-label="Remove passport"
                class="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 hover:bg-red-50 hover:text-red-500"
                @click="removePassport(passport.id)"
              >
                <Icon name="lucide:trash-2" class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </template>

        <!-- Edit mode -->
        <template v-else>
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sand-900">
                {{ countryName(passport.countryCode) }}
              </span>
              <span class="text-xs text-sand-600">{{ passport.countryCode }}</span>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                :value="editPassportNumber"
                type="text"
                placeholder="Passport number"
                class="rounded-lg border border-sand-200 bg-sand-50 px-3 py-1.5 text-sm font-mono uppercase text-sand-900 placeholder:normal-case placeholder:text-sand-400 focus:border-terra-400 focus:outline-none"
                @input="
                  editPassportNumber = ($event.target as HTMLInputElement).value.toUpperCase()
                "
              />
              <input
                v-model="editExpiryDate"
                type="date"
                placeholder="Expiry date"
                class="rounded-lg border border-sand-200 bg-sand-50 px-3 py-1.5 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                :disabled="savingEdit"
                class="rounded-lg border border-sand-200 px-3 py-1.5 text-xs font-medium text-sand-600 hover:bg-sand-50 disabled:opacity-50"
                @click="cancelEditing"
              >
                Cancel
              </button>
              <button
                type="button"
                :disabled="savingEdit"
                class="inline-flex items-center gap-1.5 rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600 disabled:opacity-50"
                @click="saveEdit(passport.id)"
              >
                <Icon v-if="savingEdit" name="lucide:loader" class="h-3 w-3 animate-spin" />
                {{ savingEdit ? "Saving…" : "Save" }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Add passport form -->
    <div class="space-y-2 rounded-xl border border-dashed border-sand-300 p-4">
      <p class="text-xs font-medium text-sand-600">Add passport</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label :for="countryFieldId" class="mb-1 block text-xs font-medium text-sand-700">
            Country
          </label>
          <select
            :id="countryFieldId"
            v-model="newCountryCode"
            class="w-full appearance-none rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
          >
            <option value="" disabled>Select country</option>
            <option v-for="opt in countryOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div>
          <label :for="numberFieldId" class="mb-1 block text-xs font-medium text-sand-700">
            Passport number
          </label>
          <input
            :id="numberFieldId"
            :value="newPassportNumber"
            type="text"
            placeholder="Passport number"
            class="w-full rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm font-mono uppercase text-sand-900 placeholder:normal-case placeholder:text-sand-400 focus:border-terra-400 focus:outline-none"
            @input="newPassportNumber = ($event.target as HTMLInputElement).value.toUpperCase()"
          />
        </div>
        <div>
          <label :for="expiryFieldId" class="mb-1 block text-xs font-medium text-sand-700">
            Expiry date
          </label>
          <input
            :id="expiryFieldId"
            v-model="newExpiryDate"
            type="date"
            class="w-full rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
          />
        </div>
      </div>
      <div class="flex justify-end">
        <button
          type="button"
          :disabled="!newCountryCode || adding"
          class="inline-flex items-center gap-1.5 rounded-lg bg-terra-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
          @click="addPassport"
        >
          <Icon v-if="adding" name="lucide:loader" class="h-3.5 w-3.5 animate-spin" />
          {{ adding ? "Adding…" : "Add Passport" }}
        </button>
      </div>
    </div>
  </div>
</template>
