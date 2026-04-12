<script setup lang="ts">
definePageMeta({ layout: "app" })

const route = useRoute()
const tripId = route.params.id as string

const { data: trip, status, refresh } = await useFetch<TripResponse>(`/api/trips/${tripId}`)

const tripTitle = computed(() => (trip.value ? `${trip.value.destination}` : "Trip"))
const tripDescription = computed(() =>
  trip.value
    ? `AI-planned itinerary for ${trip.value.destination}. View and edit your travel plans with verified places.`
    : "View and edit your AI-planned travel itinerary.",
)

useSeoMeta({
  title: tripTitle,
  description: tripDescription,
})

const { data: ideas, refresh: refreshIdeas } = await useFetch<
  {
    id: string
    name: string
    type: string | null
    address: string | null
    lat: number | null
    lng: number | null
    placeId: string | null
  }[]
>(`/api/trips/${tripId}/ideas`)

const { data: expensesList, refresh: refreshExpenses } = await useFetch<
  {
    id: string
    description: string
    amount: string
    category: string
    paidAt: string | null
  }[]
>(`/api/trips/${tripId}/expenses`)

const { data: aiUsage, refresh: refreshUsage } = await useFetch<{
  used: number
  limit: number
  remaining: number
}>("/api/ai/usage")

const { data: tripFlights, refresh: refreshFlights } = await useFetch(
  `/api/trips/${tripId}/flights`,
)

const sortedTripFlights = computed(() => {
  if (!tripFlights.value) return []
  const today = new Date().toISOString().split("T")[0]!
  return [...tripFlights.value].toSorted((a, b) => {
    const aDate = (a as Record<string, unknown>).flightDate as string
    const bDate = (b as Record<string, unknown>).flightDate as string
    const aUpcoming = aDate >= today
    const bUpcoming = bDate >= today
    // Upcoming flights first
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1
    const dateCmp = aDate.localeCompare(bDate)
    // Upcoming: ascending, Past: descending
    if (dateCmp !== 0) return aUpcoming ? dateCmp : -dateCmp
    const aDep = (a as Record<string, unknown>).departureTime as string | null
    const bDep = (b as Record<string, unknown>).departureTime as string | null
    if (aDep && bDep) {
      const aLocal = new Date(aDep).toLocaleTimeString("en-US", { hour12: false })
      const bLocal = new Date(bDep).toLocaleTimeString("en-US", { hour12: false })
      const timeCmp = aLocal.localeCompare(bLocal)
      return aUpcoming ? timeCmp : -timeCmp
    }
    if (!aDep) return 1
    if (!bDep) return -1
    return 0
  })
})

const { flightListItems } = useLayoverDetection(
  sortedTripFlights as unknown as Ref<
    {
      id: string
      flightNumber: string
      flightDate: string
      departureAirport: string | null
      arrivalAirport: string | null
      departureTime: string | null
      arrivalTime: string | null
      [key: string]: unknown
    }[]
  >,
)

const { data: tripMembers } = await useFetch<
  {
    userId: string
    user: { name: string; image: string | null }
    role: string
    status: string
  }[]
>(`/api/trips/${tripId}/members`)

const { data: participantsMap, refresh: refreshParticipants } = await useFetch<
  Record<string, { userId: string; name: string; image: string | null }[]>
>(`/api/trips/${tripId}/participants`)

async function handleToggleParticipant(activityId: string, userId: string) {
  const current = participantsMap.value?.[activityId] ?? []
  const isAssigned = current.some((p) => p.userId === userId)
  try {
    if (isAssigned) {
      await $fetch(`/api/trips/${tripId}/activities/${activityId}/participants/${userId}`, {
        method: "DELETE",
      })
    } else {
      await $fetch(`/api/trips/${tripId}/activities/${activityId}/participants`, {
        method: "POST",
        body: { userId },
      })
    }
    await refreshParticipants()
  } catch (e: unknown) {
    console.error("Failed to toggle participant:", e)
  }
}

const aiLoading = ref(false)
const aiLoadingMode = ref<"generate" | "optimize" | "remove" | "reschedule">("generate")
const lastSnapshot = ref<string | null>(null)
interface TripActivity {
  id: string
  name: string
  type: string
  description: string | null
  lat: number | null
  lng: number | null
  address: string | null
  rating: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
  actualCost: string | null
  photos: string[] | null
  openingHours: string[] | null
  tags: string[] | null
  placeId: string | null
  sortOrder: number
}

interface TripDay {
  id: string
  dayNumber: number
  date: string
  notes: string | null
  accommodationName: string | null
  accommodationAddress: string | null
  accommodationLat: number | null
  accommodationLng: number | null
  accommodationPlaceId: string | null
  activities: TripActivity[]
  travelSegments: {
    fromActivityId: string
    durationText: string | null
    distanceText: string | null
  }[]
}

interface TripResponse {
  id: string
  destination: string
  startDate: string
  endDate: string
  status: string
  budget: string | null
  currencyCode: string
  tripNotes: string | null
  shareToken: string | null
  preferences: {
    budget?: string
    pace?: string
    interests?: string[]
    travelStyle?: string[]
  } | null
  days: TripDay[]
  _role: string
}
const editingActivity = ref<TripActivity | null>(null)
const editModalOpen = ref(false)
const highlightedActivityId = ref<string | null>(null)
const tripMapRef = ref<InstanceType<typeof TripMap> | null>(null)
const activityLogRef = ref<{ refresh: () => void } | null>(null)
const logRefreshKey = ref(0)
const storageKeyTab = `trip-${tripId}-tab`
const storageKeyDay = `trip-${tripId}-day`

type TabValue =
  | "overview"
  | "itinerary"
  | "notes"
  | "expenses"
  | "reservations"
  | "documents"
  | "team"
  | "flights"
const validTabs: TabValue[] = [
  "overview",
  "itinerary",
  "notes",
  "expenses",
  "reservations",
  "documents",
  "team",
  "flights",
]
const activeTab = ref<TabValue>("overview")

// Restore tab from sessionStorage on client mount
onMounted(() => {
  const stored = sessionStorage.getItem(`trip-${tripId}-tab`)
  const match = validTabs.find((t) => t === stored)
  if (match) activeTab.value = match
})
const activeDayId = ref<string | null>(null)
const showPrefsEditor = ref(false)

function handleExportKml() {
  if (!trip.value) return
  downloadKml(
    trip.value.destination,
    sortedDays.value.map((d) => ({
      dayNumber: d.dayNumber,
      date: d.date,
      activities: d.activities,
    })),
  )
}

function handleNavigateToDay(dayId: string) {
  activeDayId.value = dayId
  activeTab.value = "itinerary"
  if (import.meta.client) {
    sessionStorage.setItem(storageKeyTab, "itinerary")
    sessionStorage.setItem(storageKeyDay, dayId)
  }
}

const { downloadPdf } = useExportPdf()

async function handleExportPdf() {
  if (!trip.value) return
  try {
    const reservations = await $fetch<
      {
        type: string
        status: string
        name: string
        confirmationNumber: string | null
        provider: string | null
        startDate: string | null
        endDate: string | null
        amount: string | null
      }[]
    >(`/api/trips/${tripId}/reservations`)
    await downloadPdf({
      destination: trip.value.destination,
      startDate: trip.value.startDate,
      endDate: trip.value.endDate,
      currencyCode: trip.value.currencyCode ?? "USD",
      budget: trip.value.budget ?? null,
      days: sortedDays.value,
      expenses: expensesList.value ?? [],
      reservations,
    })
  } catch (e: unknown) {
    console.error("Failed to export PDF:", e)
  }
}

async function updateTripField(field: string, value: string) {
  if (!trip.value) return
  try {
    await $fetch(`/api/trips/${tripId}`, {
      method: "PUT",
      body: { [field]: value },
    })
    await refresh()
  } catch (e: unknown) {
    console.error(`Failed to update ${field}:`, e)
  }
}

const { confirm } = useConfirm()

// Trip flights
const tripFlightNumber = ref("")
const tripFlightDate = ref("")
const addingTripFlight = ref(false)

async function addTripFlight() {
  if (!tripFlightNumber.value || !tripFlightDate.value) return
  addingTripFlight.value = true
  try {
    await $fetch("/api/flights", {
      method: "POST",
      body: {
        flightNumber: tripFlightNumber.value,
        flightDate: tripFlightDate.value,
        tripId: tripId,
      },
    })
    tripFlightNumber.value = ""
    tripFlightDate.value = ""
    await refreshFlights()
  } catch (e: unknown) {
    console.error("Failed to add flight:", e)
  } finally {
    addingTripFlight.value = false
  }
}

async function deleteTripFlight(flightId: string) {
  const ok = await confirm({
    title: "Delete flight",
    message: "Are you sure you want to delete this flight?",
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return
  await $fetch(`/api/flights/${flightId}`, { method: "DELETE" })
  await refreshFlights()
}

const currencyConverting = ref(false)

async function handleCurrencyChange(newCurrency: string) {
  if (!trip.value || newCurrency === trip.value.currencyCode) return
  const oldCurrency = trip.value.currencyCode || "USD"

  const ok = await confirm({
    title: "Convert currency",
    message: `Convert all costs and expenses from ${oldCurrency} to ${newCurrency} using live exchange rates?`,
    confirmText: "Convert",
  })
  if (!ok) return

  currencyConverting.value = true
  try {
    await $fetch(`/api/trips/${tripId}/convert-currency`, {
      method: "POST",
      body: { from: oldCurrency, to: newCurrency },
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to convert currency:", e)
  } finally {
    currencyConverting.value = false
  }
}

async function updatePreference(key: string, value: string | string[]) {
  if (!trip.value) return
  const currentPrefs = trip.value.preferences ?? {}
  const updatedPrefs = { ...currentPrefs, [key]: value || undefined }
  try {
    await $fetch(`/api/trips/${tripId}`, {
      method: "PUT",
      body: { preferences: updatedPrefs },
    })
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to update preferences:", e)
  }
}
let sessionRestored = false

if (import.meta.client) {
  watch(activeTab, (val) => sessionStorage.setItem(storageKeyTab, val))
  watch(activeDayId, (val) => {
    if (sessionRestored) sessionStorage.setItem(storageKeyDay, val ?? "")
  })
}
const addActivityModal = ref<{
  open: boolean
  dayId: string
  dayNumber: number
}>({ open: false, dayId: "", dayNumber: 1 })

const TripMap = resolveComponent("TripMap") as ReturnType<typeof defineComponent>

const allActivities = computed(() => {
  if (!trip.value?.days) return []
  return trip.value.days
    .toSorted((a, b) => a.dayNumber - b.dayNumber)
    .flatMap((day) => day.activities)
})

const hasActivities = computed(() => sortedDays.value.some((d) => d.activities.length > 0))

const todayDate = new Date().toISOString().slice(0, 10)

const sortedDays = computed(() => {
  if (!trip.value?.days) return []
  return [...trip.value.days].toSorted((a, b) => a.dayNumber - b.dayNumber)
})

const activeDay = computed(() => sortedDays.value.find((d) => d.id === activeDayId.value) ?? null)

const activeDayActivities = computed(() => activeDay.value?.activities ?? [])

const totalExpenses = computed(() => {
  if (!expensesList.value) return 0
  return expensesList.value.reduce((sum, e) => sum + parseFloat(e.amount), 0)
})

// Set activeDayId: prioritize today's date > sessionStorage > first day
watch(
  sortedDays,
  (days) => {
    if (days.length === 0) return

    // On first client-side run, auto-select today's day or restore from sessionStorage
    if (import.meta.client && !sessionRestored) {
      sessionRestored = true

      // Priority 1: If one of the days matches today, jump to it
      const today = new Date().toISOString().slice(0, 10)
      const todayDay = days.find((d) => d.date === today)
      if (todayDay) {
        activeDayId.value = todayDay.id
        return
      }

      // Priority 2: Restore from sessionStorage
      const storedDay = sessionStorage.getItem(storageKeyDay)
      if (storedDay && days.some((d) => d.id === storedDay)) {
        activeDayId.value = storedDay
        return
      }
    }

    // If current day is valid, keep it
    if (activeDayId.value && days.some((d) => d.id === activeDayId.value)) return

    // Default to first day
    activeDayId.value = days[0]!.id
  },
  { immediate: true },
)

const aiError = ref("")
const aiMessage = ref("")
const aiPrompt = ref("")

async function submitAiPrompt(prompt: string) {
  if (!activeDayId.value || !prompt.trim()) return
  aiPrompt.value = ""
  aiError.value = ""
  aiMessage.value = ""
  aiLoading.value = true

  // Snapshot current activities for undo
  lastSnapshot.value = JSON.stringify(activeDay.value?.activities ?? [])

  // Guess loading mode for the overlay based on prompt keywords
  if (/\b(optimize|reorder|rearrange|best route|efficient)\b/i.test(prompt)) {
    aiLoadingMode.value = "optimize"
  } else if (/\b(remove|delete|drop|get rid of)\b/i.test(prompt)) {
    aiLoadingMode.value = "remove"
  } else if (
    /\b(reschedule|move.*earlier|move.*later|too late|too early|change.*time)\b/i.test(prompt)
  ) {
    aiLoadingMode.value = "reschedule"
  } else {
    aiLoadingMode.value = "generate"
  }

  try {
    const result = await $fetch(`/api/trips/${tripId}/days/${activeDayId.value}/ai`, {
      method: "POST",
      body: { prompt },
    })
    aiMessage.value = result.message
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    aiError.value = err.data?.message ?? "Something went wrong"
    lastSnapshot.value = null // Clear snapshot on error
  } finally {
    aiLoading.value = false
    refreshUsage()
  }
}

async function handleAiSubmit() {
  await submitAiPrompt(aiPrompt.value.trim())
}

const undoLoading = ref(false)
const undoAvailable = computed(() => !!lastSnapshot.value && !!aiMessage.value)

async function handleUndo() {
  if (!activeDayId.value || !lastSnapshot.value) return
  undoLoading.value = true
  try {
    await $fetch(`/api/trips/${tripId}/days/${activeDayId.value}/restore`, {
      method: "POST",
      body: { activities: JSON.parse(lastSnapshot.value) },
    })
    lastSnapshot.value = null
    aiMessage.value = ""
    await refresh()
  } catch {
    aiError.value = "Failed to undo. Please try again."
  } finally {
    undoLoading.value = false
  }
}

async function handleUpdateDayNotes(notes: string) {
  if (!activeDayId.value) return
  try {
    await $fetch(`/api/trips/${tripId}/days/${activeDayId.value}/notes`, {
      method: "PUT",
      body: { notes: notes || null },
    })
  } catch (e: unknown) {
    console.error("Failed to update day notes:", e)
  }
}

// Clear undo state when switching days
watch(activeDayId, () => {
  lastSnapshot.value = null
  aiMessage.value = ""
  aiError.value = ""
})

const tripRole = computed(() => trip.value?._role ?? "owner")
const isViewer = computed(() => tripRole.value === "viewer")

const activeDayHasActivities = computed(() => (activeDay.value?.activities.length ?? 0) > 0)

function handleEditActivity(activity: TripActivity) {
  editingActivity.value = activity
  editModalOpen.value = true
}

async function handleSaveActivity(data: {
  name: string
  description: string | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
  actualCost: string | null
}) {
  if (!editingActivity.value) return

  try {
    await $fetch(`/api/trips/${tripId}/activities/${editingActivity.value.id}`, {
      method: "PUT",
      body: data,
    })
    editModalOpen.value = false

    // Recompute travel segments for the affected day
    const affectedDayId = findDayForActivity(editingActivity.value.id)
    editingActivity.value = null
    if (affectedDayId) {
      await recomputeSegments(affectedDayId)
    }
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to update activity:", e)
  }
}

async function handleDeleteActivity(activity: TripActivity) {
  const ok = await confirm({
    title: "Delete activity",
    message: `Remove "${activity.name}" from this day?`,
    confirmText: "Delete",
    destructive: true,
  })
  if (!ok) return

  const affectedDayId = findDayForActivity(activity.id)

  try {
    await $fetch(`/api/trips/${tripId}/activities/${activity.id}`, {
      method: "DELETE",
    })
    if (affectedDayId) {
      await recomputeSegments(affectedDayId)
    }
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to delete activity:", e)
  }
}

function handleActivityClick(activity: TripActivity) {
  highlightedActivityId.value = activity.id
  if (tripMapRef.value && activity.lat && activity.lng) {
    tripMapRef.value.centerOnActivity(activity)
  }
}

function handleMarkerClick(activity: TripActivity) {
  highlightedActivityId.value = activity.id

  const el = document.getElementById(`activity-${activity.id}`)
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }
}

function handleAddActivity(dayId: string) {
  const day = sortedDays.value.find((d) => d.id === dayId)
  addActivityModal.value = {
    open: true,
    dayId,
    dayNumber: day?.dayNumber ?? 1,
  }
}

async function handleActivityAdded() {
  // Server already recomputes segments on activity add, just refresh data
  await refresh()
}

const showMoreMenu = ref(false)

// Close more menu on click outside
if (import.meta.client) {
  document.addEventListener("click", (e) => {
    if (showMoreMenu.value && !(e.target as HTMLElement).closest(".relative")) {
      showMoreMenu.value = false
    }
  })
}

const shareLoading = ref(false)
const shareCopied = ref(false)

async function handleToggleShare() {
  shareLoading.value = true
  try {
    const result = await $fetch(`/api/trips/${tripId}/share`, { method: "POST" })
    await refresh()
    if (result.shared && result.shareToken) {
      const url = `${window.location.origin}/shared/${result.shareToken}`
      await navigator.clipboard.writeText(url)
      shareCopied.value = true
      setTimeout(() => {
        shareCopied.value = false
      }, 2000)
    }
  } catch (e: unknown) {
    console.error("Failed to toggle share:", e)
  } finally {
    shareLoading.value = false
  }
}

async function handleCopyShareLink() {
  if (!trip.value?.shareToken) return
  const url = `${window.location.origin}/shared/${trip.value.shareToken}`
  await navigator.clipboard.writeText(url)
  shareCopied.value = true
  setTimeout(() => {
    shareCopied.value = false
  }, 2000)
}

async function handleIdeasRefresh() {
  await refreshIdeas()
  await refresh()
}

function findDayForActivity(activityId: string): string | null {
  if (!trip.value?.days) return null
  for (const day of trip.value.days) {
    if (day.activities.some((a) => a.id === activityId)) {
      return day.id
    }
  }
  return null
}

async function recomputeSegments(dayId: string) {
  try {
    await $fetch(`/api/trips/${tripId}/days/${dayId}/segments`, {
      method: "POST",
    })
  } catch (e: unknown) {
    console.error("Failed to recompute segments:", e)
  }
}
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="status === 'pending'" class="flex items-center justify-center py-24">
      <Icon name="lucide:loader" class="h-6 w-6 animate-spin text-terra-400" />
    </div>

    <!-- Not found -->
    <div v-else-if="!trip" class="py-24 text-center">
      <p class="text-sand-600">Trip not found.</p>
      <NuxtLink
        to="/dashboard"
        class="mt-4 inline-block text-sm font-medium text-terra-600 underline decoration-terra-300 transition hover:text-terra-700"
      >
        Back to dashboard
      </NuxtLink>
    </div>

    <!-- Trip detail -->
    <div v-else>
      <!-- Header -->
      <div>
        <div class="flex items-center gap-3">
          <NuxtLink
            to="/dashboard"
            class="shrink-0 rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
          >
            <Icon name="lucide:arrow-left" class="h-5 w-5" />
          </NuxtLink>
          <div class="min-w-0">
            <h1 class="truncate font-display text-2xl text-sand-900 sm:text-3xl">
              {{ trip.destination }}
            </h1>
            <div
              class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-sand-500 sm:text-sm sm:gap-2"
            >
              <span class="flex items-center gap-1">
                <Icon name="lucide:calendar" class="h-3 w-3 sm:h-3.5 sm:w-3.5" />
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
              </span>
              <span class="text-sand-300">·</span>
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="getTripStatus(trip.startDate, trip.endDate).badgeClass"
              >
                {{ getTripStatus(trip.startDate, trip.endDate).label }}
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-terra-50 px-2.5 py-1 text-xs font-medium text-terra-700">
            {{ sortedDays.length }} days
          </span>
          <button
            v-if="!isViewer"
            class="inline-flex items-center gap-1.5 rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium text-sand-600 transition hover:bg-sand-200"
            title="Edit trip preferences"
            @click="showPrefsEditor = !showPrefsEditor"
          >
            <Icon name="lucide:sliders-horizontal" class="h-3 w-3" />
            <span class="hidden sm:inline">Preferences</span>
            <span class="sm:hidden">Prefs</span>
          </button>
          <span
            v-if="trip.preferences?.budget"
            class="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-sand-500 capitalize"
          >
            {{ trip.preferences.budget }}
          </span>
          <span
            v-if="trip.preferences?.pace"
            class="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-sand-500 capitalize"
          >
            {{ trip.preferences.pace }}
          </span>
          <!-- More options dropdown -->
          <div class="relative">
            <button
              class="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2 py-1 text-xs font-medium text-sand-600 transition hover:bg-sand-200"
              title="More options"
              @click="showMoreMenu = !showMoreMenu"
            >
              <Icon name="lucide:more-horizontal" class="h-3.5 w-3.5" />
            </button>
            <Transition
              enter-active-class="duration-150 ease-out"
              enter-from-class="opacity-0 scale-95"
              enter-to-class="opacity-100 scale-100"
              leave-active-class="duration-100 ease-in"
              leave-from-class="opacity-100 scale-100"
              leave-to-class="opacity-0 scale-95"
            >
              <div
                v-if="showMoreMenu"
                class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
              >
                <button
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
                  @click="
                    () => {
                      handleExportKml()
                      showMoreMenu = false
                    }
                  "
                >
                  <Icon name="lucide:map" class="h-4 w-4 text-sand-400" />
                  Export KML
                </button>
                <button
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
                  @click="
                    () => {
                      handleExportPdf()
                      showMoreMenu = false
                    }
                  "
                >
                  <Icon name="lucide:file-down" class="h-4 w-4 text-sand-400" />
                  Export PDF
                </button>
              </div>
            </Transition>
          </div>
          <!-- Share button (owner only) -->
          <template v-if="tripRole === 'owner'">
            <button
              v-if="!trip.shareToken"
              :disabled="shareLoading"
              class="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium text-sand-600 transition hover:bg-sand-200 disabled:opacity-50"
              title="Generate shareable public link"
              @click="handleToggleShare"
            >
              <Icon
                :name="shareLoading ? 'lucide:loader' : 'lucide:share-2'"
                class="h-3 w-3"
                :class="{ 'animate-spin': shareLoading }"
              />
              <span class="hidden sm:inline">Share</span>
            </button>
            <div v-else class="inline-flex items-center gap-1">
              <button
                class="inline-flex items-center gap-1 rounded-l-full bg-ocean-50 px-2.5 py-1 text-xs font-medium text-ocean-700 transition hover:bg-ocean-100"
                title="Copy share link"
                @click="handleCopyShareLink"
              >
                <Icon :name="shareCopied ? 'lucide:check' : 'lucide:link'" class="h-3 w-3" />
                <span class="hidden sm:inline">{{ shareCopied ? "Copied!" : "Copy Link" }}</span>
              </button>
              <button
                :disabled="shareLoading"
                class="inline-flex items-center rounded-r-full bg-sand-100 px-2 py-1 text-xs text-sand-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                title="Revoke share link"
                @click="handleToggleShare"
              >
                <Icon name="lucide:x" class="h-3 w-3" />
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- Preferences editor -->
      <div v-if="showPrefsEditor" class="mt-4 rounded-xl border border-sand-200 bg-white p-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-sand-900">Trip Preferences</h3>
          <button
            class="text-xs text-sand-400 hover:text-sand-600"
            @click="showPrefsEditor = false"
          >
            <Icon name="lucide:x" class="h-4 w-4" />
          </button>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div>
            <label class="block text-xs font-medium text-sand-500">Budget</label>
            <select
              :value="trip.preferences?.budget || ''"
              class="mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus"
              @change="updatePreference('budget', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Any</option>
              <option value="budget">Budget</option>
              <option value="moderate">Moderate</option>
              <option value="luxury">Luxury</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-sand-500">Pace</label>
            <select
              :value="trip.preferences?.pace || ''"
              class="mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus"
              @change="updatePreference('pace', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Any</option>
              <option value="relaxed">Relaxed</option>
              <option value="moderate">Moderate</option>
              <option value="packed">Packed</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-sand-500">Currency</label>
            <select
              :value="trip.currencyCode || 'USD'"
              :disabled="currencyConverting"
              class="mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus disabled:opacity-50"
              @change="handleCurrencyChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="JPY">JPY (¥)</option>
              <option value="KRW">KRW (₩)</option>
              <option value="THB">THB (฿)</option>
              <option value="SGD">SGD (S$)</option>
              <option value="AUD">AUD (A$)</option>
              <option value="CAD">CAD (C$)</option>
              <option value="MYR">MYR (RM)</option>
              <option value="IDR">IDR (Rp)</option>
              <option value="TWD">TWD (NT$)</option>
              <option value="VND">VND (₫)</option>
              <option value="PHP">PHP (₱)</option>
              <option value="INR">INR (₹)</option>
              <option value="CNY">CNY (¥)</option>
            </select>
          </div>
          <div class="sm:col-span-3">
            <label class="block text-xs font-medium text-sand-500">Interests</label>
            <input
              :value="trip.preferences?.interests?.join(', ') || ''"
              type="text"
              placeholder="e.g. temples, street food, nature, nightlife"
              class="mt-1 block w-full rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus"
              @change="
                updatePreference(
                  'interests',
                  ($event.target as HTMLInputElement).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              "
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-sand-400">AI suggestions will respect these preferences.</p>
      </div>

      <!-- Tabs -->
      <div class="mt-6">
        <TripDetailTabs v-model="activeTab" />
      </div>

      <!-- Itinerary tab -->
      <!-- Overview tab -->
      <div v-if="activeTab === 'overview'" class="mt-6">
        <TripOverview
          :trip="trip"
          :sorted-days="sortedDays"
          :expenses-list="expensesList ?? []"
          :total-expenses="totalExpenses"
          :currency-code="trip.currencyCode ?? 'USD'"
          @navigate-to-day="handleNavigateToDay"
        />
      </div>

      <div v-else-if="activeTab === 'itinerary'" class="mt-6">
        <!-- Day tabs (client-only to avoid hydration mismatch with sessionStorage) -->
        <ClientOnly>
          <div class="flex gap-1.5 overflow-x-auto pb-2 scrollbar-thin sm:gap-2">
            <button
              v-for="day in sortedDays"
              :key="day.id"
              class="relative shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition sm:px-4 sm:text-sm"
              :class="
                day.id === activeDayId
                  ? 'bg-terra-500 text-white shadow-sm'
                  : day.date === todayDate
                    ? 'bg-terra-50 text-terra-700 ring-1 ring-terra-300 hover:bg-terra-100'
                    : 'bg-sand-100 text-sand-600 hover:bg-sand-200'
              "
              @click="activeDayId = day.id"
            >
              <span class="sm:hidden">D{{ day.dayNumber }}</span>
              <span class="hidden sm:inline"
                >Day {{ day.dayNumber }} &middot;
                <NuxtTime
                  :datetime="day.date + 'T00:00:00'"
                  locale="en-US"
                  weekday="short"
                  month="short"
                  day="numeric"
              /></span>
              <span
                v-if="day.date === todayDate && day.id !== activeDayId"
                class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-terra-500"
              />
            </button>
          </div>
        </ClientOnly>

        <!-- Generate all empty days (experimental) -->
        <GenerateFullItineraryButton
          v-if="!isViewer"
          :trip-id="tripId"
          :days="sortedDays"
          :disabled="aiLoading || (aiUsage?.remaining ?? 1) <= 0"
          :ai-remaining="aiUsage?.remaining"
          class="mt-3"
          @done="
            () => {
              refresh()
              refreshUsage()
            }
          "
        />

        <!-- AI prompt bar (hidden for viewers) -->
        <div v-if="activeDay && !isViewer" class="mt-4">
          <!-- Quick action buttons -->
          <div class="mb-2 flex items-center justify-between">
            <AiQuickActions
              :disabled="aiLoading || (aiUsage?.remaining ?? 1) <= 0"
              :has-activities="activeDayHasActivities"
              @fill-gaps="aiPrompt = 'Fill in the gaps in my schedule for today'"
              @optimize-route="
                aiPrompt = 'Optimize the route and reorder activities for minimum travel time'
              "
            />
            <!-- Usage counter -->
            <span
              v-if="aiUsage"
              class="shrink-0 text-xs tabular-nums"
              :class="aiUsage.remaining <= 10 ? 'text-terra-500 font-medium' : 'text-sand-400'"
              :title="`${aiUsage.used}/${aiUsage.limit} AI prompts used this month`"
            >
              {{ aiUsage.used }}/{{ aiUsage.limit }}
            </span>
          </div>

          <form class="flex items-center gap-1.5 sm:gap-2" @submit.prevent="handleAiSubmit">
            <div class="relative min-w-0 flex-1">
              <Icon
                name="lucide:sparkles"
                class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-terra-400 sm:h-4 sm:w-4"
              />
              <input
                v-model="aiPrompt"
                type="text"
                :disabled="aiLoading || (aiUsage?.remaining ?? 1) <= 0"
                :placeholder="
                  (aiUsage?.remaining ?? 1) <= 0
                    ? `Limit reached. Resets next month.`
                    : activeDayHasActivities
                      ? 'Add, remove, reschedule, find a hotel...'
                      : 'What to do today?'
                "
                class="input-focus block w-full rounded-xl border border-sand-200 bg-white py-2 pl-9 pr-3 text-sm text-sand-900 placeholder:text-sand-400 disabled:opacity-50 sm:py-2.5 sm:pl-10 sm:pr-4"
              />
            </div>
            <button
              type="submit"
              :disabled="aiLoading || !aiPrompt.trim() || (aiUsage?.remaining ?? 1) <= 0"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-terra-500 text-white transition hover:bg-terra-600 disabled:opacity-50 sm:h-10 sm:w-10"
            >
              <Icon
                :name="aiLoading ? 'lucide:loader' : 'lucide:arrow-up'"
                class="h-4 w-4"
                :class="{ 'animate-spin': aiLoading }"
              />
            </button>
          </form>

          <!-- Prompt suggestions -->
          <AiPromptSuggestions
            v-if="!aiLoading && !aiMessage && !aiError && trip"
            :destination="trip.destination"
            :has-activities="activeDayHasActivities"
            @select="aiPrompt = $event"
          />

          <!-- AI feedback messages -->
          <div
            v-if="aiMessage && !aiError"
            class="mt-2 flex items-center gap-2 rounded-lg bg-forest-50 px-3 py-2 text-sm text-forest-700"
          >
            <Icon name="lucide:check-circle" class="h-4 w-4 shrink-0" />
            <span>{{ aiMessage }}</span>
            <button
              v-if="undoAvailable"
              :disabled="undoLoading"
              class="ml-auto shrink-0 text-sm font-medium text-forest-700 underline underline-offset-2 hover:text-forest-900 disabled:opacity-50"
              @click="handleUndo"
            >
              <span v-if="undoLoading">Undoing...</span>
              <span v-else>Undo</span>
            </button>
            <button
              class="shrink-0 text-forest-400 hover:text-forest-700"
              :class="{ 'ml-auto': !undoAvailable }"
              @click="
                () => {
                  aiMessage = ''
                  lastSnapshot = null
                }
              "
            >
              <Icon name="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            v-if="aiError"
            class="mt-2 flex items-start gap-2 rounded-lg bg-terra-50 px-3 py-2 text-sm text-terra-600"
          >
            <Icon name="lucide:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ aiError }}</span>
            <button
              class="ml-auto shrink-0 text-terra-400 hover:text-terra-700"
              @click="aiError = ''"
            >
              <Icon name="lucide:x" class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- Active day content -->
        <div v-if="activeDay" class="mt-4">
          <div class="flex flex-col gap-6 lg:flex-row">
            <!-- Left: Accommodation + Activities + Ideas -->
            <div class="flex-1 space-y-6 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto lg:pr-4">
              <!-- Accommodation (hidden for viewers) -->
              <AccommodationSection
                v-if="!isViewer"
                :trip-id="tripId"
                :day-id="activeDay.id"
                :accommodation-name="activeDay.accommodationName"
                :accommodation-address="activeDay.accommodationAddress"
                :accommodation-lat="activeDay.accommodationLat"
                :accommodation-lng="activeDay.accommodationLng"
                @updated="refresh"
              />

              <!-- AI loading overlay -->
              <AiLoadingOverlay :visible="aiLoading" :mode="aiLoadingMode" />

              <!-- Activities for this day -->
              <DaySection
                v-show="!aiLoading"
                :day="activeDay"
                :trip-id="tripId"
                :highlighted-activity-id="highlightedActivityId"
                :travel-segments="activeDay.travelSegments"
                :readonly="isViewer"
                :participants-map="participantsMap ?? undefined"
                :members="tripMembers?.filter((m) => m.status === 'active')"
                @edit-activity="handleEditActivity"
                @delete-activity="handleDeleteActivity"
                @click-activity="handleActivityClick"
                @add-activity="handleAddActivity"
                @reordered="refresh"
                @update-notes="handleUpdateDayNotes"
                @toggle-participant="handleToggleParticipant"
              />

              <!-- Ideas bucket (hidden for viewers) -->
              <IdeasBucket
                v-if="!isViewer"
                v-show="!aiLoading"
                :trip-id="tripId"
                :ideas="ideas ?? []"
                :days="sortedDays.map((d) => ({ id: d.id, dayNumber: d.dayNumber, date: d.date }))"
                :active-day-id="activeDayId"
                @refresh="handleIdeasRefresh"
              />
            </div>

            <!-- Right: Map -->
            <div class="order-first lg:order-none lg:w-[480px] lg:shrink-0">
              <div
                class="h-[250px] overflow-hidden rounded-2xl shadow-lg sm:h-[300px] lg:sticky lg:top-8 lg:h-[calc(100vh-320px)]"
              >
                <TripMap
                  ref="tripMapRef"
                  :activities="activeDayActivities"
                  :accommodation="
                    activeDay
                      ? {
                          name: activeDay.accommodationName,
                          lat: activeDay.accommodationLat,
                          lng: activeDay.accommodationLng,
                        }
                      : null
                  "
                  @marker-click="handleMarkerClick"
                />
              </div>
            </div>
          </div>

          <!-- Stats -->
          <div class="mt-8">
            <TripStats
              :days="sortedDays"
              :budget="trip.budget ?? null"
              :currency-code="trip.currencyCode ?? 'USD'"
              :total-expenses="totalExpenses"
            />
          </div>
        </div>
      </div>

      <!-- Notes tab -->
      <div v-else-if="activeTab === 'notes'" class="mt-8 space-y-6 max-w-3xl">
        <TripNotesPanel :trip-id="tripId" :notes="trip.tripNotes ?? null" />
        <ChecklistPanel :trip-id="tripId" />
      </div>

      <!-- Expenses tab -->
      <div v-else-if="activeTab === 'expenses'" class="mt-8 max-w-3xl">
        <ExpenseTracker
          :trip-id="tripId"
          :trip-name="trip.destination"
          :budget="trip.budget ?? null"
          :currency-code="trip.currencyCode ?? 'USD'"
          :members="tripMembers?.filter((m) => m.status === 'active') ?? []"
          @budget-updated="refresh"
        />
      </div>

      <!-- Bookings tab -->
      <div v-else-if="activeTab === 'reservations'" class="mt-8 max-w-3xl">
        <ReservationTracker :trip-id="tripId" :currency-code="trip.currencyCode ?? 'USD'" />
      </div>

      <!-- Documents tab -->
      <div v-else-if="activeTab === 'documents'" class="mt-8 max-w-3xl">
        <DocumentPanel :trip-id="tripId" />
      </div>

      <!-- Team tab -->
      <div v-else-if="activeTab === 'team'" class="mt-8 max-w-3xl space-y-6">
        <TripMembers
          :trip-id="tripId"
          :current-role="trip?._role ?? 'owner'"
          @changed="logRefreshKey++"
        />
        <TripActivityLog :key="logRefreshKey" :trip-id="tripId" />
      </div>

      <!-- Flights tab -->
      <div v-else-if="activeTab === 'flights'" class="mt-8 max-w-3xl space-y-4">
        <h2 class="font-display text-lg text-sand-900">Flights</h2>

        <FlightGlobe v-if="sortedTripFlights.length > 0" :flights="sortedTripFlights" />

        <!-- Add flight form (auto-links to this trip) -->
        <form
          class="flex flex-col gap-3 rounded-2xl border border-sand-200 bg-white p-5 sm:flex-row sm:items-end"
          @submit.prevent="addTripFlight"
        >
          <div class="flex-1">
            <label class="mb-1 block text-xs font-medium text-sand-600">Flight number</label>
            <input
              v-model="tripFlightNumber"
              type="text"
              placeholder="e.g. SQ638"
              class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-400 focus:border-terra-400 focus:outline-none"
            />
          </div>
          <div class="flex-1">
            <label class="mb-1 block text-xs font-medium text-sand-600">Date</label>
            <input
              v-model="tripFlightDate"
              type="date"
              class="w-full rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            :disabled="addingTripFlight || !tripFlightNumber || !tripFlightDate"
            class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
          >
            {{ addingTripFlight ? "Adding..." : "Add Flight" }}
          </button>
        </form>

        <div v-if="flightListItems.length" class="space-y-3">
          <template v-for="(item, idx) in flightListItems" :key="idx">
            <FlightCard
              v-if="item.type === 'flight'"
              :flight="item.flight"
              :hide-visa-badge="flightListItems[idx + 1]?.type === 'layover'"
              @delete="deleteTripFlight"
            />
            <LayoverCard v-else-if="item.type === 'layover'" :layover="item" />
          </template>
        </div>
        <div v-else class="rounded-2xl border border-dashed border-sand-300 p-8 text-center">
          <Icon name="lucide:plane" class="mx-auto h-8 w-8 text-sand-300" />
          <p class="mt-2 text-sm text-sand-500">
            No flights yet. Add a flight above to track it with this trip.
          </p>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <EditActivityModal
      :activity="editingActivity"
      :open="editModalOpen"
      @save="handleSaveActivity"
      @close="editModalOpen = false"
    />

    <!-- Add activity modal -->
    <AddActivityModal
      :open="addActivityModal.open"
      :trip-id="tripId"
      :day-id="addActivityModal.dayId"
      :day-number="addActivityModal.dayNumber"
      @added="handleActivityAdded"
      @close="addActivityModal.open = false"
    />
  </div>
</template>
