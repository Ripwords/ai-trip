<script setup lang="ts">
import type { CountryInfo } from "../data/countries";
import type { VisitType } from "../components/ScratchMap.vue";

definePageMeta({ layout: "app" });
useSeoMeta({
  title: "Explore",
  description: "Track countries you've visited on your scratch map.",
});

// Fetch visited countries
const { data: visitedList, refresh } = await useFetch("/api/visited-countries");

// Map of countryCode → visitType
const visitMap = computed(() => {
  const map = new Map<string, VisitType>();
  for (const v of visitedList.value ?? []) {
    map.set(v.countryCode, (v.visitType as VisitType) ?? "visited");
  }
  return map;
});

// Selected country panel
const selectedCountry = ref<CountryInfo | null>(null);
const panelLoading = ref(false);

function handleCountryClick(country: CountryInfo) {
  selectedCountry.value = country;
}

function closePanel() {
  selectedCountry.value = null;
}

async function setVisitType(country: CountryInfo, type: VisitType | null) {
  panelLoading.value = true;
  try {
    if (type === null) {
      // Remove
      await $fetch(`/api/visited-countries/${country.alpha2}`, { method: "DELETE" });
    } else {
      // Add or update (upsert)
      await $fetch("/api/visited-countries", {
        method: "POST",
        body: { countryCode: country.alpha2, countryName: country.name, visitType: type },
      });
    }
    await refresh();
  } catch (e: unknown) {
    console.error("Failed to update visit type:", e);
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
        <h1 class="font-display text-3xl text-sand-900">Explore</h1>
        <p class="mt-1 text-sm text-sand-500">
          Click on a country to mark it as visited or check visa requirements.
        </p>
      </div>
    </div>

    <!-- Map + Panel Container -->
    <div class="relative mt-6">
      <ScratchMap
        :visit-map="visitMap"
        @country-click="handleCountryClick"
      />
      <CountryDetailPanel
        :country="selectedCountry"
        :visit-type="selectedCountry ? visitMap.get(selectedCountry.alpha2) : undefined"
        :loading="panelLoading"
        @close="closePanel"
        @set-visit-type="setVisitType"
        @check-visa="handleCheckVisa"
      />
    </div>

    <VisaChecker
      v-if="showVisaChecker"
      :destination="visaDestination"
      @close="showVisaChecker = false"
    />
  </div>
</template>
