<script setup lang="ts">
import { countries } from "../data/countries"

interface Passport {
  id: string
  countryCode: string
  label: string | null
  isDefault: boolean
}

const { data: passports, refresh } = await useFetch<Passport[]>("/api/user/passports")

const newCountryCode = ref("")
const newLabel = ref("")
const adding = ref(false)

const countryOptions = computed(() =>
  countries
    .map((c) => ({ value: c.alpha2, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
)

function countryName(code: string): string {
  return countries.find((c) => c.alpha2 === code)?.name ?? code
}

async function addPassport() {
  if (!newCountryCode.value) return
  adding.value = true
  try {
    await $fetch("/api/user/passports", {
      method: "POST",
      body: {
        countryCode: newCountryCode.value,
        label: newLabel.value || null,
      },
    })
    newCountryCode.value = ""
    newLabel.value = ""
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

async function removePassport(id: string) {
  if (!confirm("Remove this passport?")) return
  await $fetch(`/api/user/passports/${id}`, { method: "DELETE" })
  await refresh()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Existing passports -->
    <div v-if="passports?.length" class="space-y-2">
      <div
        v-for="passport in passports"
        :key="passport.id"
        class="flex items-center gap-3 rounded-xl border border-sand-200 px-4 py-3 dark:border-sand-700"
      >
        <span class="text-lg">{{ countryName(passport.countryCode) }}</span>
        <span class="text-xs text-sand-500">{{ passport.countryCode }}</span>
        <span v-if="passport.label" class="text-xs text-sand-400">({{ passport.label }})</span>
        <button
          v-if="!passport.isDefault"
          class="ml-auto text-xs text-sand-400 hover:text-terra-500"
          title="Set as default"
          @click="setDefault(passport.id)"
        >
          <Icon name="lucide:star" class="h-4 w-4" />
        </button>
        <Icon
          v-else
          name="lucide:star"
          class="ml-auto h-4 w-4 text-terra-500"
          title="Default passport"
        />
        <button
          class="text-sand-400 hover:text-red-500"
          title="Remove"
          @click="removePassport(passport.id)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Add passport form -->
    <div class="flex flex-col gap-2 sm:flex-row">
      <select
        v-model="newCountryCode"
        class="flex-1 rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100"
      >
        <option value="" disabled>Select country</option>
        <option v-for="opt in countryOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <input
        v-model="newLabel"
        type="text"
        placeholder="Label (optional)"
        class="rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-400 focus:border-terra-400 focus:outline-none dark:border-sand-700 dark:bg-sand-800 dark:text-sand-100 sm:w-40"
      />
      <button
        :disabled="!newCountryCode || adding"
        class="rounded-xl bg-terra-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
        @click="addPassport"
      >
        Add
      </button>
    </div>
  </div>
</template>
