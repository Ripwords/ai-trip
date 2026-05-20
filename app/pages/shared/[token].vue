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
  placeId: string | null
  photos: string[] | null
}

interface SharedDay {
  id: string
  dayNumber: number
  date: string
  accommodationName: string | null
  accommodationAddress: string | null
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
    "@type": "ItemPage",
    name: sharedTitle,
    description: sharedDescription,
    touristType: "Traveler",
  }),
])

const activeDayId = ref<string | null>(null)
const highlightedActivityId = ref<string | null>(null)
const tripMapRef = ref<{ centerOnActivity: (a: SharedActivity) => void } | null>(null)

function handleActivityClick(activity: SharedActivity) {
  highlightedActivityId.value = activity.id
  if (tripMapRef.value && activity.lat != null && activity.lng != null) {
    tripMapRef.value.centerOnActivity(activity)
  }
}

function handleMarkerClick(activity: { id: string }) {
  highlightedActivityId.value = activity.id
  const el = document.getElementById(`shared-activity-${activity.id}`)
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }
}

const sortedDays = computed(() => {
  if (!trip.value?.days) return []
  return [...trip.value.days].toSorted((a, b) => a.dayNumber - b.dayNumber)
})

// Derive the current day from data so SSR and client agree on first render —
// Vue does not rectify hydration class mismatches in production.
const currentDayId = computed(() => {
  if (activeDayId.value && sortedDays.value.some((d) => d.id === activeDayId.value)) {
    return activeDayId.value
  }
  return sortedDays.value[0]?.id ?? null
})

const activeDay = computed(() => sortedDays.value.find((d) => d.id === currentDayId.value) ?? null)

const activeDayPreviousAccommodation = computed(() => {
  const day = activeDay.value
  if (!day) return null
  const days = sortedDays.value
  const index = days.findIndex((d) => d.id === day.id)
  const previousDay = index > 0 ? days[index - 1] : null
  if (!previousDay?.accommodationName) return null
  return {
    name: previousDay.accommodationName,
    lat: previousDay.accommodationLat,
    lng: previousDay.accommodationLng,
  }
})

function mapsLinkFor(activity: SharedActivity): string {
  const base = "https://www.google.com/maps/search/?api=1&query="
  if (activity.lat != null && activity.lng != null) {
    return `${base}${activity.lat},${activity.lng}`
  }
  const q = [activity.name, activity.address].filter(Boolean).join(", ")
  return `${base}${encodeURIComponent(q)}`
}

function thumbnailUrlFor(activity: SharedActivity): string | null {
  const photo = activity.photos?.[0]
  const placeId = activity.placeId
  if (!photo || !placeId) return null
  if (!photo.startsWith(`places/${placeId}/photos/`)) return null
  const params = new URLSearchParams({
    placeId,
    photo,
    maxWidthPx: "240",
  })
  return `/api/shared/${token}/photo?${params.toString()}`
}

const imageFailed = reactive<Record<string, boolean>>({})
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
            day.id === currentDayId
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
        <!-- Left: accommodation + activity list -->
        <div class="flex-1 space-y-3">
          <div
            v-if="activeDay.accommodationName"
            class="rounded-2xl border border-ocean-200 bg-ocean-50 p-4"
          >
            <div class="flex items-start gap-3">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ocean-100"
              >
                <Icon name="lucide:bed-double" class="h-4 w-4 text-ocean-600" />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-sand-900">
                  {{ activeDay.accommodationName }}
                </p>
                <p v-if="activeDay.accommodationAddress" class="mt-0.5 text-xs text-sand-500">
                  {{ activeDay.accommodationAddress }}
                </p>
              </div>
            </div>
          </div>

          <div
            v-for="(activity, index) in activeDay.activities"
            :id="`shared-activity-${activity.id}`"
            :key="activity.id"
            class="cursor-pointer rounded-2xl border bg-white p-5 transition"
            :class="
              highlightedActivityId === activity.id
                ? 'border-terra-400 ring-2 ring-terra-200'
                : 'border-sand-200 hover:border-terra-300'
            "
            @click="handleActivityClick(activity)"
          >
            <div class="flex items-start gap-3">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
              >
                {{ index + 1 }}
              </span>
              <div
                class="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sand-100 text-sand-300"
              >
                <img
                  v-if="thumbnailUrlFor(activity) && !imageFailed[activity.id]"
                  :src="thumbnailUrlFor(activity)!"
                  :alt="activity.name"
                  class="h-full w-full object-cover"
                  loading="lazy"
                  @error="imageFailed[activity.id] = true"
                />
                <Icon v-else name="lucide:image" class="h-5 w-5" />
              </div>
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
                    @click.stop
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
              ref="tripMapRef"
              :activities="activeDay.activities"
              :start-accommodation="activeDayPreviousAccommodation"
              :end-accommodation="{
                name: activeDay.accommodationName,
                lat: activeDay.accommodationLat,
                lng: activeDay.accommodationLng,
              }"
              @marker-click="handleMarkerClick"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
