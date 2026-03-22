<script setup lang="ts">
definePageMeta({ layout: "app" });
useHead({ title: "New Trip — AI Trip" });

const destination = ref("");
const startDate = ref("");
const endDate = ref("");
const budget = ref<string>();
const pace = ref<string>();
const error = ref("");
const loading = ref(false);

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
        preferences: {
          budget: budget.value || undefined,
          pace: pace.value || undefined,
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
  <div class="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-lg">
    <h1 class="font-display text-2xl text-sand-900">Plan a New Trip</h1>

    <form class="mt-8 space-y-6" @submit.prevent="handleCreate">
      <div>
        <label
          for="destination"
          class="block text-sm font-medium text-sand-700"
        >
          Destination
        </label>
        <input
          id="destination"
          v-model="destination"
          type="text"
          required
          placeholder="e.g. Tokyo, Japan"
          class="input-focus mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm"
        />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label
            for="startDate"
            class="block text-sm font-medium text-sand-700"
          >
            Start date
          </label>
          <input
            id="startDate"
            v-model="startDate"
            type="date"
            required
            class="input-focus mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label
            for="endDate"
            class="block text-sm font-medium text-sand-700"
          >
            End date
          </label>
          <input
            id="endDate"
            v-model="endDate"
            type="date"
            required
            class="input-focus mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="budget" class="block text-sm font-medium text-sand-700">
            Budget
          </label>
          <select
            id="budget"
            v-model="budget"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm"
          >
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
          <select
            id="pace"
            v-model="pace"
            class="input-focus mt-1 block w-full rounded-lg border border-sand-300 px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            <option value="relaxed">Relaxed</option>
            <option value="moderate">Moderate</option>
            <option value="packed">Packed</option>
          </select>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full rounded-xl bg-terra-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
      >
        {{ loading ? "Creating..." : "Create Trip" }}
      </button>
    </form>
  </div>
</template>
