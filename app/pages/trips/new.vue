<script setup lang="ts">
definePageMeta({ layout: "app" });
useHead({ title: "New Trip — AI Trip" });

const destination = ref("");
const startDate = ref("");
const endDate = ref("");
const budget = ref<string>();
const pace = ref<string>();
const currencyCode = ref("USD");
const travelStyle = ref<string[]>([]);
const error = ref("");
const loading = ref(false);

const currencies = [
  { code: "USD", label: "USD ($)" },
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "JPY", label: "JPY (¥)" },
  { code: "KRW", label: "KRW (₩)" },
  { code: "THB", label: "THB (฿)" },
  { code: "SGD", label: "SGD (S$)" },
  { code: "AUD", label: "AUD (A$)" },
  { code: "CAD", label: "CAD (C$)" },
  { code: "MYR", label: "MYR (RM)" },
  { code: "IDR", label: "IDR (Rp)" },
  { code: "TWD", label: "TWD (NT$)" },
  { code: "VND", label: "VND (₫)" },
  { code: "PHP", label: "PHP (₱)" },
  { code: "INR", label: "INR (₹)" },
  { code: "CNY", label: "CNY (¥)" },
];

const travelStyleOptions = ["foodie", "culture", "adventure", "nature", "nightlife", "shopping", "relaxation", "photography"];

function toggleStyle(style: string) {
  const idx = travelStyle.value.indexOf(style);
  if (idx >= 0) travelStyle.value.splice(idx, 1);
  else travelStyle.value.push(style);
}

async function handleCreate() {
  error.value = "";
  loading.value = true;

  try {
    const trip = await $fetch("/api/trips", {
      method: "POST",
      body: {
        destination: destination.value,
        startDate: startDate.value,
        endDate: endDate.value,
        currencyCode: currencyCode.value,
        preferences: {
          budget: budget.value || undefined,
          pace: pace.value || undefined,
          travelStyle: travelStyle.value.length ? travelStyle.value : undefined,
        },
      },
    });

    navigateTo(`/trips/${trip.id}`);
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string };
    error.value = err.data?.message ?? err.message ?? "Failed to create trip";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg rounded-2xl bg-white p-5 shadow-lg sm:p-8">
    <h1 class="font-display text-2xl text-sand-900">Plan a New Trip</h1>

    <form class="mt-8 space-y-5" @submit.prevent="handleCreate">
      <div>
        <label for="destination" class="block text-sm font-medium text-sand-700">
          Destination
        </label>
        <input
          id="destination"
          v-model="destination"
          type="text"
          required
          placeholder="e.g. Tokyo, Japan"
          class="form-input"
        />
      </div>

      <div class="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
        <div>
          <label for="startDate" class="block text-sm font-medium text-sand-700">
            Start date
          </label>
          <input
            id="startDate"
            v-model="startDate"
            type="date"
            required
            class="form-input"
          />
        </div>
        <div>
          <label for="endDate" class="block text-sm font-medium text-sand-700">
            End date
          </label>
          <input
            id="endDate"
            v-model="endDate"
            type="date"
            required
            class="form-input"
          />
        </div>
      </div>

      <div class="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
        <div>
          <label for="budget" class="block text-sm font-medium text-sand-700">
            Budget
          </label>
          <select id="budget" v-model="budget" class="form-input">
            <option value="">Any</option>
            <option value="budget">Budget</option>
            <option value="moderate">Moderate</option>
            <option value="luxury">Luxury</option>
          </select>
        </div>
        <div>
          <label for="pace" class="block text-sm font-medium text-sand-700">
            Pace
          </label>
          <select id="pace" v-model="pace" class="form-input">
            <option value="">Any</option>
            <option value="relaxed">Relaxed</option>
            <option value="moderate">Moderate</option>
            <option value="packed">Packed</option>
          </select>
        </div>
      </div>

      <!-- Currency -->
      <div>
        <label for="currency" class="block text-sm font-medium text-sand-700">Currency</label>
        <select id="currency" v-model="currencyCode" class="form-input">
          <option v-for="c in currencies" :key="c.code" :value="c.code">{{ c.label }}</option>
        </select>
      </div>

      <!-- Travel style -->
      <div>
        <label class="block text-sm font-medium text-sand-700">Travel Style</label>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="style in travelStyleOptions"
            :key="style"
            type="button"
            class="rounded-full border px-3 py-1 text-xs font-medium capitalize transition"
            :class="travelStyle.includes(style)
              ? 'border-terra-400 bg-terra-50 text-terra-700'
              : 'border-sand-200 bg-sand-50 text-sand-600 hover:border-sand-300'"
            @click="toggleStyle(style)"
          >
            {{ style }}
          </button>
        </div>
      </div>

      <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded-xl bg-terra-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-terra-600 disabled:opacity-50"
      >
        {{ loading ? "Creating..." : "Create Trip" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.form-input {
  display: block;
  width: 100%;
  margin-top: 0.375rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--color-sand-300);
  border-radius: 0.75rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--color-sand-900);
  background-color: var(--color-sand-50);
  appearance: none;
  -webkit-appearance: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.form-input:focus {
  border-color: var(--color-terra-400);
  box-shadow: 0 0 0 3px rgba(240, 123, 90, 0.1);
  outline: none;
}

/* Select arrow */
select.form-input {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239f8b6f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  padding-right: 2.5rem;
}

/* Fix date input vertical alignment on iOS/Safari */
input[type="date"].form-input {
  display: flex;
  align-items: center;
}
</style>
