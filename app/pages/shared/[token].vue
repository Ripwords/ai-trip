<script setup lang="ts">
definePageMeta({ layout: "default" })

interface SharedActivity {
  id: string
  name: string
  type: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  rating: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  tags: string[]
  sortOrder: number
}

interface SharedDay {
  id: string
  dayNumber: number
  date: string
  accommodationName: string | null
  accommodationLat: number | null
  accommodationLng: number | null
  activities: SharedActivity[]
}

interface SharedTrip {
  destination: string
  startDate: string
  endDate: string
  currencyCode: string
  days: SharedDay[]
}

const route = useRoute()
const token = route.params.token as string

const { data: trip, error } = useLazyFetch<SharedTrip>(`/api/shared/${token}`)

const sharedTitle = computed(() =>
  trip.value ? `${trip.value.destination} — Shared Trip` : "Shared Trip",
)
const sharedDescription = computed(() =>
  trip.value
    ? `Check out this AI-planned itinerary for ${trip.value.destination} with ${trip.value.days?.length ?? 0} days of activities and verified places.`
    : "View a shared AI-planned travel itinerary.",
)

useSeoMeta({
  title: sharedTitle,
  description: sharedDescription,
  ogTitle: sharedTitle,
  ogDescription: sharedDescription,
})

useSchemaOrg([
  defineWebPage({
    "@type": "TouristTrip",
    name: sharedTitle,
    description: sharedDescription,
    touristType: "Traveler",
  }),
])

const activeDayId = ref<string | null>(null)

const sortedDays = computed(() => {
  if (!trip.value?.days) return []
  return [...trip.value.days].toSorted((a, b) => a.dayNumber - b.dayNumber)
})

const activeDay = computed(() => sortedDays.value.find((d) => d.id === activeDayId.value) ?? null)

function mapsLinkFor(activity: SharedActivity): string {
  const base = "https://www.google.com/maps/search/?api=1&query="
  if (activity.lat != null && activity.lng != null) {
    return `${base}${activity.lat},${activity.lng}`
  }
  const q = [activity.name, activity.address].filter(Boolean).join(", ")
  return `${base}${encodeURIComponent(q)}`
}

watch(
  sortedDays,
  (days) => {
    if (days.length > 0 && !activeDayId.value) {
      activeDayId.value = days[0]?.id ?? null
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <div v-if="error" class="text-center">
      <h1 class="font-display text-2xl text-sand-900">Trip Not Found</h1>
      <p class="mt-2 text-sand-600">This shared link may have expired or been removed.</p>
    </div>

    <div v-else-if="trip">
      <!-- Header -->
      <div class="text-center">
        <h1 class="font-display text-3xl text-sand-900">{{ trip.destination }}</h1>
        <p class="mt-1 flex items-center justify-center gap-1 text-sm text-sand-500">
          <Icon name="lucide:calendar" class="h-3.5 w-3.5" />
          <NuxtTime
            :datetime="trip.startDate + 'T00:00:00'"
            locale="en-US"
            month="short"
            day="numeric"
          />
          -
          <NuxtTime
            :datetime="trip.endDate + 'T00:00:00'"
            locale="en-US"
            month="short"
            day="numeric"
            year="numeric"
          />
        </p>
        <span
          class="mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="getTripStatus(trip.startDate, trip.endDate).badgeClass"
        >
          {{ getTripStatus(trip.startDate, trip.endDate).label }}
        </span>
      </div>

      <!-- Day tabs -->
      <div class="mt-8 flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        <button
          v-for="day in sortedDays"
          :key="day.id"
          class="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition"
          :class="
            day.id === activeDayId
              ? 'bg-terra-500 text-white shadow-sm'
              : 'bg-sand-100 text-sand-600 hover:bg-sand-200'
          "
          @click="activeDayId = day.id"
        >
          Day {{ day.dayNumber }} &middot;
          <NuxtTime
            :datetime="day.date + 'T00:00:00'"
            locale="en-US"
            weekday="short"
            month="short"
            day="numeric"
          />
        </button>
      </div>

      <!-- Day content -->
      <div v-if="activeDay" class="mt-6 flex flex-col gap-6 lg:flex-row">
        <!-- Left: activity list -->
        <div class="flex-1 space-y-3">
          <div
            v-for="(activity, index) in activeDay.activities"
            :key="activity.id"
            class="rounded-2xl border border-sand-200 bg-white p-5"
          >
            <div class="flex items-start gap-3">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
              >
                {{ index + 1 }}
              </span>
              <div class="min-w-0">
                <h4 class="text-base font-semibold text-sand-900">{{ activity.name }}</h4>
                <p v-if="activity.description" class="mt-1 text-sm text-sand-600">
                  {{ activity.description }}
                </p>
                <div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-sand-500">
                  <span
                    v-if="activity.suggestedTime"
                    class="inline-flex items-center gap-1 rounded-full bg-terra-50 px-2.5 py-0.5 text-xs font-semibold text-terra-700"
                  >
                    <Icon name="lucide:clock" class="h-3 w-3" />
                    {{ formatTime12h(activity.suggestedTime) }}
                  </span>
                  <a
                    v-if="activity.address"
                    :href="mapsLinkFor(activity)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 truncate text-ocean-600 transition hover:text-terra-600"
                    title="Open in Google Maps"
                  >
                    <Icon name="lucide:map-pin" class="h-3.5 w-3.5 shrink-0" />
                    <span
                      class="truncate underline decoration-ocean-300 underline-offset-2 hover:decoration-terra-400"
                      >{{ activity.address }}</span
                    >
                    <Icon name="lucide:external-link" class="h-3 w-3 shrink-0 opacity-50" />
                  </a>
                </div>
              </div>
            </div>
          </div>
          <p v-if="!activeDay.activities.length" class="text-center text-sm text-sand-400 py-8">
            No activities planned for this day.
          </p>
        </div>

        <!-- Right: map -->
        <div class="order-first lg:order-none lg:w-[420px] lg:shrink-0">
          <div
            class="h-[260px] overflow-hidden rounded-2xl shadow-lg sm:h-[320px] lg:sticky lg:top-8 lg:h-[calc(100vh-200px)]"
          >
            <TripMap
              :activities="activeDay.activities"
              :accommodation="{
                name: activeDay.accommodationName,
                lat: activeDay.accommodationLat,
                lng: activeDay.accommodationLng,
              }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
