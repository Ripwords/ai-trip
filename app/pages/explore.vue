<script setup lang="ts">
import type { CountryInfo } from "../data/countries"
import type { VisitType } from "../components/ScratchMap.vue"

definePageMeta({ layout: "app" })
useSeoMeta({
  title: "Explore",
  description: "Track countries you've visited on your scratch map.",
})

// Fetch visited countries
const { data: visitedList, refresh } = useLazyFetch("/api/visited-countries")

// Passport nationality — controls visa data for tooltips
const { nationality, save: saveNationality, fetch: fetchNationality } = useNationality()
onMounted(async () => {
  if (!nationality.value) {
    try {
      const passports = await $fetch("/api/user/passports")
      if (passports.length > 0) {
        nationality.value = passports[0]!.countryCode
      } else {
        await fetchNationality()
      }
    } catch {
      await fetchNationality()
    }
  }
})

const nationalityInitialized = ref(false)
watch(nationality, (val) => {
  if (!nationalityInitialized.value) {
    nationalityInitialized.value = true
    return
  }
  saveNationality(val)
})

// Fetch visa statuses — reactively refetches when nationality changes
const { data: visaStatusMap } = useLazyFetch<
  Record<string, { visaStatus: string; maxStayDays: number | null }>
>("/api/visa/check-all", {
  query: { passport: nationality },
  watch: [nationality],
})

// Map of countryCode → visitType
const visitMap = computed(() => {
  const map = new Map<string, VisitType>()
  for (const v of visitedList.value ?? []) {
    map.set(v.countryCode, (v.visitType as VisitType) ?? "visited")
  }
  return map
})

// View mode: 2D flat map vs 3D globe
// Cookie is available during SSR so the correct view renders immediately (no flash)
const viewModeCookie = useCookie<"2d" | "3d">("explore-view-mode", {
  default: () => "2d",
  maxAge: 60 * 60 * 24 * 365,
})
const viewMode = viewModeCookie

function handleToggleView() {
  viewMode.value = viewMode.value === "2d" ? "3d" : "2d"
}

// Selected country panel
const selectedCountry = ref<CountryInfo | null>(null)
const panelLoading = ref(false)

function handleCountryClick(country: CountryInfo) {
  selectedCountry.value = country
}

function closePanel() {
  selectedCountry.value = null
}

async function setVisitType(country: CountryInfo, type: VisitType | null) {
  panelLoading.value = true
  try {
    if (type === null) {
      // Remove
      await $fetch(`/api/visited-countries/${country.alpha2}`, { method: "DELETE" })
    } else {
      // Add or update (upsert)
      await $fetch("/api/visited-countries", {
        method: "POST",
        body: { countryCode: country.alpha2, countryName: country.name, visitType: type },
      })
    }
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to update visit type:", e)
  } finally {
    panelLoading.value = false
  }
}

// Visa checker state
const showVisaChecker = ref(false)
const visaDestination = ref<CountryInfo | null>(null)

function handleCheckVisa(country: CountryInfo) {
  visaDestination.value = country
  showVisaChecker.value = true
}
</script>

<template>
  <div>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="font-display text-3xl text-sand-900">Explore</h1>
        <p class="mt-1 text-sm text-sand-500">
          Click on a country to mark it as visited or check visa requirements.
        </p>
      </div>
      <div class="w-full sm:w-48 sm:shrink-0">
        <label class="mb-1 block text-xs font-medium text-sand-600">Your passport</label>
        <NationalitySelector v-model="nationality" />
      </div>
    </div>

    <!-- Map + Panel Container -->
    <div class="relative mt-6">
      <Suspense v-if="viewMode === '2d'">
        <LazyScratchMap
          :visit-map="visitMap"
          :visa-status-map="visaStatusMap ?? {}"
          @country-click="handleCountryClick"
          @toggle-view="handleToggleView"
        />
        <template #fallback>
          <SkeletonMap mode="2d" />
        </template>
      </Suspense>
      <ClientOnly v-else>
        <LazyGlobeScratchMap
          :visit-map="visitMap"
          :visa-status-map="visaStatusMap ?? {}"
          @country-click="handleCountryClick"
          @toggle-view="handleToggleView"
        />
        <template #fallback>
          <SkeletonMap mode="3d" />
        </template>
      </ClientOnly>
      <LazyCountryDetailPanel
        :country="selectedCountry"
        :visit-type="selectedCountry ? visitMap.get(selectedCountry.alpha2) : undefined"
        :visa-status="selectedCountry ? visaStatusMap?.[selectedCountry.alpha2] : undefined"
        :loading="panelLoading"
        @close="closePanel"
        @set-visit-type="setVisitType"
        @check-visa="handleCheckVisa"
      />
    </div>

    <LazyVisaChecker
      v-if="showVisaChecker"
      :destination="visaDestination"
      @close="showVisaChecker = false"
    />
  </div>
</template>
