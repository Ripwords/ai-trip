<script setup lang="ts">
definePageMeta({ layout: "app" });
useHead({ title: "My Trips — AI Trip" });

const { data: trips, status, refresh } = await useFetch("/api/trips");

const { confirm } = useConfirm();

async function handleDelete(tripId: string, destination: string) {
  const ok = await confirm({
    title: "Delete trip",
    message: `Delete trip to "${destination}"? This cannot be undone.`,
    confirmText: "Delete",
    destructive: true,
  });
  if (!ok) return;

  try {
    await $fetch(`/api/trips/${tripId}`, { method: "DELETE" });
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to delete trip:", e);
  }
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} - ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

function getDayCount(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <h1 class="font-display text-3xl text-sand-900">My Trips</h1>
      <NuxtLink
        to="/trips/new"
        class="inline-flex items-center gap-2 rounded-xl bg-terra-500 px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-terra-600 hover:shadow-lg hover:shadow-terra-500/20"
      >
        <Icon name="lucide:plus" class="h-4 w-4" />
        New Trip
      </NuxtLink>
    </div>

    <div v-if="status === 'pending'" class="mt-8 text-center text-sand-500">
      <Icon name="lucide:loader" class="mx-auto h-6 w-6 animate-spin text-terra-400" />
      <p class="mt-2 text-sm">Loading trips...</p>
    </div>

    <div
      v-else-if="!trips?.length"
      class="mt-16 flex flex-col items-center justify-center text-center"
    >
      <div class="rounded-full bg-terra-50 p-4">
        <Icon name="lucide:map-pin" class="h-8 w-8 text-terra-400" />
      </div>
      <h2 class="mt-4 font-display text-lg text-sand-900">No trips yet</h2>
      <p class="mt-2 max-w-sm text-sm text-sand-600">
        Create your first trip and let AI plan the perfect itinerary for you.
      </p>
      <NuxtLink
        to="/trips/new"
        class="mt-6 inline-flex items-center gap-2 rounded-xl bg-terra-500 px-6 py-3 text-sm font-medium text-white shadow-md shadow-terra-500/15 transition hover:bg-terra-600 hover:shadow-lg hover:shadow-terra-500/20"
      >
        <Icon name="lucide:plus" class="h-4 w-4" />
        Create your first trip
      </NuxtLink>
    </div>

    <div v-else class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="trip in trips"
        :key="trip.id"
        class="card-hover group relative rounded-2xl border border-sand-200 bg-white"
      >
        <NuxtLink
          :to="`/trips/${trip.id}`"
          class="block p-6"
        >
          <h2 class="font-display text-lg text-sand-900">
            {{ trip.destination }}
          </h2>
          <p class="mt-1 flex items-center gap-1 text-sm text-sand-500">
            <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
            {{ formatDateRange(trip.startDate, trip.endDate) }}
          </p>
          <div class="mt-3 flex items-center gap-2">
            <span
              class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
              :class="getTripStatus(trip.startDate, trip.endDate).badgeClass"
            >
              {{ getTripStatus(trip.startDate, trip.endDate).label }}
            </span>
            <span class="text-xs text-sand-400">
              {{ getDayCount(trip.startDate, trip.endDate) }} days
            </span>
          </div>
        </NuxtLink>

        <button
          class="absolute right-3 top-3 rounded p-1.5 text-sand-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
          title="Delete trip"
          @click.stop="handleDelete(trip.id, trip.destination)"
        >
          <Icon name="lucide:trash-2" class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>
