<script setup lang="ts">
import type { CountryInfo } from "../data/countries";

definePageMeta({ layout: "app" });
useSeoMeta({
  title: "Explore",
  description: "Track countries you've visited on your scratch map.",
});

// Fetch visited countries
const { data: visitedList, refresh } = await useFetch("/api/visited-countries");
const visitedCodes = computed(() => new Set(visitedList.value?.map((v) => v.countryCode) ?? []));

// Selected country panel
const selectedCountry = ref<CountryInfo | null>(null);
const panelLoading = ref(false);

function handleCountryClick(country: CountryInfo) {
  selectedCountry.value = country;
}

function closePanel() {
  selectedCountry.value = null;
}

async function toggleVisited(country: CountryInfo) {
  panelLoading.value = true;
  try {
    if (visitedCodes.value.has(country.alpha2)) {
      await $fetch(`/api/visited-countries/${country.alpha2}`, { method: "DELETE" });
    } else {
      await $fetch("/api/visited-countries", {
        method: "POST",
        body: { countryCode: country.alpha2, countryName: country.name },
      });
    }
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to toggle visited status:", e);
  } finally {
    panelLoading.value = false;
  }
}

// Visa checker state
const showVisaChecker = ref(false);
const visaDestination = ref<CountryInfo | null>(null);

function handleCheckVisa(country: CountryInfo) {
  visaDestination.value = country;
  showVisaChecker.value = true;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="font-display text-3xl text-sand-900 dark:text-sand-100">Explore</h1>
        <p class="mt-1 text-sm text-sand-500">
          Click on a country to mark it as visited or check visa requirements.
        </p>
      </div>
    </div>

    <!-- Map + Panel Container -->
    <div class="relative mt-6">
      <ScratchMap
        :visited-codes="visitedCodes"
        @country-click="handleCountryClick"
      />
      <CountryDetailPanel
        :country="selectedCountry"
        :is-visited="!!selectedCountry && visitedCodes.has(selectedCountry.alpha2)"
        :loading="panelLoading"
        @close="closePanel"
        @toggle-visited="toggleVisited"
        @check-visa="handleCheckVisa"
      />
    </div>

    <!-- TODO: VisaChecker component (Task 13) -->
    <!-- <VisaChecker
      v-if="showVisaChecker"
      :destination="visaDestination"
      @close="showVisaChecker = false"
    /> -->
  </div>
</template>
