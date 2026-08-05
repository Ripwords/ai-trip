<script setup lang="ts">
import type { TripActivity, TripDay, TripResponse } from "~/types/trip"
import type { Proposal } from "~/types/proposal"
import type { ReviewFinding } from "~/types/review"
import type { ChatMessage } from "~/components/AiDock.vue"
import { countryByAlpha2 } from "~/data/countries"
import { parseSseFrames } from "../../utils/sse-parse"
import type { DiscussSseEvent } from "#shared/utils/discuss-sse"
import type { TripExpenseSummary } from "#shared/utils/expense-summary"
import type { ExpenseListParams } from "#shared/utils/expense-list"

definePageMeta({ layout: "app" })

type TransportMode = "driving" | "walking" | "transit" | "bicycling"

const transportModeOptions: { value: TransportMode; label: string; icon: string }[] = [
  { value: "driving", label: "Drive", icon: "lucide:car" },
  { value: "walking", label: "Walk", icon: "lucide:person-standing" },
  { value: "transit", label: "Transit", icon: "lucide:train" },
  { value: "bicycling", label: "Bike", icon: "lucide:bike" },
]

const route = useRoute()
const tripId = route.params.id as string

const { data: trip, status, refresh } = useLazyFetch<TripResponse>(`/api/trips/${tripId}`)

const tripDisplayName = computed(() => {
  const t = trip.value
  if (!t) return "Trip"
  if (t.name) return t.name
  const c = t.countryCode ? countryByAlpha2.get(t.countryCode) : null
  if (c) return `Trip to ${c.name}`
  // Legacy fallback for trips that haven't been migrated yet
  return t.destination || "Untitled trip"
})

const tripTitle = computed(() => tripDisplayName.value)
const tripDescription = computed(() =>
  trip.value
    ? `AI-planned itinerary for ${tripDisplayName.value}. View and edit your travel plans with verified places.`
    : "View and edit your AI-planned travel itinerary.",
)

useSeoMeta({
  title: tripTitle,
  description: tripDescription,
})

const { data: ideas, refresh: refreshIdeas } = useLazyFetch<
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

/**
 * Filter/sort state for the expense list (#49). It is a query object rather
 * than a client-side filter: `useLazyFetch` refetches when it changes, so the
 * database does the work and the browser never holds rows it is not showing.
 */
const expenseQuery = ref<ExpenseListParams>({
  category: "",
  payerId: "",
  from: "",
  to: "",
  sort: "createdAt",
  order: "desc",
  limit: String(EXPENSE_PAGE_SIZE_DEFAULT),
})

const { data: expensePage, refresh: refreshExpensesList } = useLazyFetch(
  `/api/trips/${tripId}/expenses`,
  { query: expenseQuery },
)

/** Pages fetched by "Load more"; the first page lives in `expensePage`. */
type LoadedExpense = NonNullable<typeof expensePage.value>["items"][number]
const extraExpenses = ref<LoadedExpense[]>([])
const expenseCursor = ref<string | null>(null)
const loadingMoreExpenses = ref(false)

watch(expensePage, (page) => {
  extraExpenses.value = []
  expenseCursor.value = page?.nextCursor ?? null
})

const expensesList = computed<LoadedExpense[]>(() => [
  ...(expensePage.value?.items ?? []),
  ...extraExpenses.value,
])

async function loadMoreExpenses() {
  const cursor = expenseCursor.value
  if (!cursor || loadingMoreExpenses.value) return
  loadingMoreExpenses.value = true
  try {
    const page = await $fetch(`/api/trips/${tripId}/expenses`, {
      query: { ...expenseQuery.value, cursor },
    })
    extraExpenses.value = [...extraExpenses.value, ...page.items]
    expenseCursor.value = page.nextCursor
  } catch (e: unknown) {
    console.error("Failed to load more expenses:", e)
    toastError("Couldn't load more expenses. Please try again.")
  } finally {
    loadingMoreExpenses.value = false
  }
}

/**
 * Every matching expense, not just the loaded pages — CSV and PDF must export
 * what the user filtered to, not what happens to be scrolled into view. The
 * per-trip cap is 200 rows, which is also the maximum page size, so this is
 * always a single request.
 */
async function fetchAllFilteredExpenses(): Promise<LoadedExpense[]> {
  const page = await $fetch(`/api/trips/${tripId}/expenses`, {
    query: { ...expenseQuery.value, limit: String(EXPENSE_PAGE_SIZE_MAX), cursor: "" },
  })
  return page.items
}

const { downloadCsv } = useExportExpenses()

async function exportExpensesCsv() {
  try {
    downloadCsv(
      trip.value?.destination ?? "trip",
      await fetchAllFilteredExpenses(),
      trip.value?.currencyCode ?? "USD",
    )
  } catch (e: unknown) {
    console.error("Failed to export expenses:", e)
    toastError("Couldn't export the expenses. Please try again.")
  }
}

/**
 * The single server-computed answer to "what does this trip cost" (#38).
 * Three components used to each add up their own version of this in the
 * browser and disagree; they now all render these numbers.
 */
const { data: expenseSummary, refresh: refreshExpenseSummary } = useLazyFetch<TripExpenseSummary>(
  `/api/trips/${tripId}/expenses/summary`,
)

/** The list and the summary are two views of the same data; refresh together. */
async function refreshExpenses() {
  await Promise.all([refreshExpensesList(), refreshExpenseSummary()])
}

const { data: tripFlights, refresh: refreshFlights } = useLazyFetch(`/api/trips/${tripId}/flights`)

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
      arrivalTimeLocal?: string | null
      [key: string]: unknown
    }[]
  >,
)

const { data: tripMembers } = useLazyFetch<
  {
    userId: string
    user: { name: string; image: string | null }
    role: string
    status: string
  }[]
>(`/api/trips/${tripId}/members`)

const { data: participantsMap, refresh: refreshParticipants } = useLazyFetch<
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
    toastError("Could not update who is assigned. Please try again.")
  }
}

// Two separate AI loading signals so the chat doesn't hide the activity list.
// - aiChatLoading: discuss endpoint is replying (chat-only; does not mutate the day)
// - aiMutating: a flow that rewrites activities is in flight (fill-gaps / optimize / generate-full)
// During `aiMutating` the DaySection stays visible but dims + goes readonly (so
// the day never blanks out mid-rewrite), while the AiDock's typing indicator
// binds to a computed OR of both so it lights up for any AI work.
const aiChatLoading = ref(false)
const aiMutating = ref(false)
const aiLoading = computed(() => aiChatLoading.value || aiMutating.value)
const editingActivity = ref<TripActivity | null>(null)
const editModalOpen = ref(false)
const savingActivity = ref(false)
const highlightedActivityId = ref<string | null>(null)
const tripMapRef = ref<InstanceType<typeof TripMap> | null>(null)
const activityLogRef = ref<{ refresh: () => void } | null>(null)
const logRefreshKey = ref(0)
const storageKeyTab = `trip-${tripId}-tab`
const storageKeyDay = `trip-${tripId}-day`

type TabValue =
  | "overview"
  | "itinerary"
  | "review"
  | "notes"
  | "expenses"
  | "reservations"
  | "team"
  | "flights"
const validTabs: TabValue[] = [
  "overview",
  "itinerary",
  "review",
  "notes",
  "expenses",
  "reservations",
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
const showSettingsSheet = ref(false)
const settingsFocusField = ref<"country" | null>(null)

function openSettings(focus: "country" | null = null) {
  settingsFocusField.value = focus
  showSettingsSheet.value = true
}

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

const accommodationSectionRef = ref<{ openEditor: () => void } | null>(null)

function handleReviewFix(finding: ReviewFinding) {
  // open edit modal for the activity referenced by the finding, if any
  const activityId = finding.activityIds?.[0]
  if (activityId) {
    const activity = sortedDays.value.flatMap((d) => d.activities).find((a) => a.id === activityId)
    if (activity) {
      handleEditActivity(activity)
      return
    }
  }
  // Otherwise no specific activity — no-op.
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
      // The whole filtered set, not the pages loaded so far (#49).
      expenses: await fetchAllFilteredExpenses(),
      reservations,
    })
  } catch (e: unknown) {
    console.error("Failed to export PDF:", e)
    toastError("Could not export the PDF. Please try again.")
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
    toastError("Could not save your change. Please try again.")
  }
}

const { confirm } = useConfirm()
const { error: toastError, success: toastSuccess, withAction: toastWithAction } = useToast()
const { snapshot: snapshotDay, restore: restoreDay } = useDayUndo(tripId)

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
    toastError("Could not add the flight. Check the flight number and try again.")
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
  try {
    await $fetch(`/api/flights/${flightId}`, { method: "DELETE" })
    await refreshFlights()
  } catch (e: unknown) {
    console.error("Failed to delete flight:", e)
    toastError("Could not delete the flight. Please try again.")
  }
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
    toastSuccess(`Converted costs from ${oldCurrency} to ${newCurrency}.`)
  } catch (e: unknown) {
    console.error("Failed to convert currency:", e)
    toastError("Could not convert the currency. Please try again.")
  } finally {
    currencyConverting.value = false
  }
}

async function updatePreference(key: string, value: string | string[]): Promise<boolean> {
  if (!trip.value) return false
  const currentPrefs = trip.value.preferences ?? {}
  const updatedPrefs = { ...currentPrefs, [key]: value || undefined }
  try {
    await $fetch(`/api/trips/${tripId}`, {
      method: "PUT",
      body: { preferences: updatedPrefs },
    })
    if (key === "transportMode") {
      await recomputeSegmentsForAllDays()
    }
    await refresh()
    return true
  } catch (e: unknown) {
    console.error("Failed to update preferences:", e)
    toastError("Could not save your preference. Please try again.")
    return false
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

const dayWeeks = computed(() => {
  const groups: (typeof sortedDays.value)[] = []
  for (let i = 0; i < sortedDays.value.length; i += 7) {
    groups.push(sortedDays.value.slice(i, i + 7))
  }
  return groups
})

const dayStripRef = ref<HTMLElement | null>(null)

async function scrollActiveDayIntoView() {
  await nextTick()
  if (!activeDayId.value || !dayStripRef.value) return
  const el = dayStripRef.value.querySelector<HTMLElement>(`[data-day-id="${activeDayId.value}"]`)
  el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
}

watch([activeDayId, activeTab], () => {
  if (activeTab.value === "itinerary") scrollActiveDayIntoView()
})

const activeDay = computed(() => sortedDays.value.find((d) => d.id === activeDayId.value) ?? null)

const activeDayActivities = computed(() => activeDay.value?.activities ?? [])

const activeTransportMode = computed<TransportMode>(
  () => trip.value?.preferences?.transportMode ?? "driving",
)

const transportUpdating = ref(false)

async function recomputeSegmentsForAllDays() {
  await Promise.all(
    sortedDays.value
      .filter((d) => d.activities.filter((a) => a.lat != null && a.lng != null).length >= 2)
      .map((d) =>
        $fetch(`/api/trips/${tripId}/days/${d.id}/segments`, {
          method: "POST",
        }),
      ),
  )
}

const activeDayStartLocation = computed(() => {
  const day = activeDay.value
  if (!day) return null
  const days = sortedDays.value
  const index = days.findIndex((d) => d.id === day.id)
  const previousDay = index > 0 ? days[index - 1] : null

  if (previousDay?.accommodationName) {
    return {
      name: previousDay.accommodationName,
      address: previousDay.accommodationAddress,
      lat: previousDay.accommodationLat,
      lng: previousDay.accommodationLng,
    }
  }

  return null
})

const activeDayEndAccommodation = computed(() => {
  const day = activeDay.value
  if (!day?.accommodationName) return null
  return {
    name: day.accommodationName,
    address: day.accommodationAddress,
    lat: day.accommodationLat,
    lng: day.accommodationLng,
  }
})

const activeDayMapsUrl = computed(() =>
  getGoogleMapsDirectionsUrl(
    activeDayActivities.value,
    activeTransportMode.value,
    activeDayStartLocation.value?.lat != null && activeDayStartLocation.value.lng != null
      ? { lat: activeDayStartLocation.value.lat, lng: activeDayStartLocation.value.lng }
      : null,
  ),
)

interface TripFlightRow {
  flightNumber: string
  flightDate: string
  departureAirport: string | null
  arrivalAirport: string | null
  departureTime: string | null
  arrivalTime: string | null
  departureDate: string | null
  arrivalDate: string | null
  departureAirportLat: number | null
  departureAirportLng: number | null
  arrivalAirportLat: number | null
  arrivalAirportLng: number | null
  departureAirportName: string | null
  arrivalAirportName: string | null
}

const activeDayArrivalFlight = computed(() => {
  const day = activeDay.value
  if (!day || sortedDays.value[0]?.id !== day.id) return null
  const flights = sortedTripFlights.value as TripFlightRow[]
  // Match by the day the flight LANDS (red-eye that departs the night before still
  // arrives on the trip's first day). Fall back to flightDate for rows without raw data.
  const match = flights.find((f) => (f.arrivalDate ?? f.flightDate) === day.date)
  if (!match) return null
  return {
    flightNumber: match.flightNumber,
    time: match.arrivalTime,
    airport: match.arrivalAirport,
  }
})

const activeDayDepartureFlight = computed(() => {
  const day = activeDay.value
  if (!day) return null
  const lastDay = sortedDays.value[sortedDays.value.length - 1]
  if (lastDay?.id !== day.id) return null
  const flights = sortedTripFlights.value as TripFlightRow[]
  const match = flights.find((f) => (f.departureDate ?? f.flightDate) === day.date)
  if (!match) return null
  return {
    flightNumber: match.flightNumber,
    time: match.departureTime,
    airport: match.departureAirport,
  }
})

interface AirportMarker {
  code: string
  name: string | null
  lat: number
  lng: number
  variant: "arrival" | "departure"
}

const tripAirports = computed<AirportMarker[]>(() => {
  const days = sortedDays.value
  if (days.length === 0) return []
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  const flights = sortedTripFlights.value as TripFlightRow[]
  const markers: AirportMarker[] = []

  const arrival = flights.find((f) => firstDay && (f.arrivalDate ?? f.flightDate) === firstDay.date)
  if (
    arrival?.arrivalAirport &&
    arrival.arrivalAirportLat != null &&
    arrival.arrivalAirportLng != null
  ) {
    markers.push({
      code: arrival.arrivalAirport,
      name: arrival.arrivalAirportName,
      lat: arrival.arrivalAirportLat,
      lng: arrival.arrivalAirportLng,
      variant: "arrival",
    })
  }

  const departure = flights.find(
    (f) => lastDay && (f.departureDate ?? f.flightDate) === lastDay.date,
  )
  if (
    departure?.departureAirport &&
    departure.departureAirportLat != null &&
    departure.departureAirportLng != null
  ) {
    markers.push({
      code: departure.departureAirport,
      name: departure.departureAirportName,
      lat: departure.departureAirportLat,
      lng: departure.departureAirportLng,
      variant: "departure",
    })
  }

  return markers
})

const activeDayAirports = computed<AirportMarker[]>(() => {
  const day = activeDay.value
  if (!day) return []
  const flights = sortedTripFlights.value as TripFlightRow[]
  const markers: AirportMarker[] = []
  const isFirstDay = sortedDays.value[0]?.id === day.id
  const isLastDay = sortedDays.value[sortedDays.value.length - 1]?.id === day.id

  if (isFirstDay) {
    const arrival = flights.find((f) => (f.arrivalDate ?? f.flightDate) === day.date)
    if (
      arrival?.arrivalAirport &&
      arrival.arrivalAirportLat != null &&
      arrival.arrivalAirportLng != null
    ) {
      markers.push({
        code: arrival.arrivalAirport,
        name: arrival.arrivalAirportName,
        lat: arrival.arrivalAirportLat,
        lng: arrival.arrivalAirportLng,
        variant: "arrival",
      })
    }
  }

  if (isLastDay) {
    const departure = flights.find((f) => (f.departureDate ?? f.flightDate) === day.date)
    if (
      departure?.departureAirport &&
      departure.departureAirportLat != null &&
      departure.departureAirportLng != null
    ) {
      markers.push({
        code: departure.departureAirport,
        name: departure.departureAirportName,
        lat: departure.departureAirportLat,
        lng: departure.departureAirportLng,
        variant: "departure",
      })
    }
  }

  return markers
})

async function handleTransportModeChange(mode: TransportMode) {
  if (mode === activeTransportMode.value || transportUpdating.value) return
  transportUpdating.value = true
  try {
    await updatePreference("transportMode", mode)
  } finally {
    transportUpdating.value = false
  }
}

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

// Auto re-enrich activities missing coordinates (e.g. Google Places was down during creation)
// Each day is attempted at most once per page session to avoid retry loops and wasted API calls
const enrichAttemptedDays = new Set<string>()

watch(
  sortedDays,
  (days) => {
    if (!import.meta.client || !trip.value) return

    for (const day of days) {
      if (enrichAttemptedDays.has(day.id)) continue

      const hasUnenriched = day.activities.some((a) => a.lat == null || a.lng == null)
      if (!hasUnenriched) continue

      enrichAttemptedDays.add(day.id)

      $fetch(`/api/trips/${tripId}/days/${day.id}/enrich`, { method: "POST" })
        .then((result) => {
          if (result.enriched > 0) refresh()
        })
        .catch(() => {})
    }
  },
  { immediate: true },
)

const dayLabels = computed<Record<string, string>>(() =>
  Object.fromEntries((trip.value?.days ?? []).map((d) => [d.id, `Day ${d.dayNumber}`])),
)

const aiInput = ref("")
const aiMessages = ref<ChatMessage[]>([])
const aiUsage = ref<{ used: number; limit: number; remaining: number } | null>(null)

const {
  run: runFullItinerary,
  running: generatingItinerary,
  currentDayIndex: generatingDayIndex,
  totalDays: generatingDayTotal,
  currentDayLabel: generatingDayLabel,
  errorMessage: generateErrorMessage,
  noticeMessage: generateNoticeMessage,
} = useGenerateFullItinerary(tripId)

async function refreshAiUsage() {
  try {
    aiUsage.value = await $fetch("/api/ai/usage")
  } catch {
    /* ignore */
  }
}

const aiStarters = useDiscussionStarters(
  trip as unknown as Ref<{
    id: string
    destination: string
    days: {
      id: string
      dayNumber: number
      accommodationName: string | null
      activities: { id: string; name: string; type: string }[]
    }[]
  } | null>,
  activeDay as unknown as Ref<{
    id: string
    dayNumber: number
    accommodationName: string | null
    activities: { id: string; name: string; type: string }[]
  } | null>,
)

function makeMessageId() {
  return crypto.randomUUID()
}

let aiAbort: AbortController | null = null

async function handleAiSubmit(text: string) {
  if (!trip.value) return
  const userMsg: ChatMessage = {
    id: makeMessageId(),
    role: "user",
    content: text,
    timestamp: Date.now(),
  }
  aiMessages.value = [...aiMessages.value, userMsg]
  aiInput.value = ""
  aiChatLoading.value = true
  const controller = new AbortController()
  aiAbort = controller

  // The assistant bubble is appended EMPTY and mutated as events arrive — that
  // is what makes tool lines and text appear live.
  const assistantId = makeMessageId()
  aiMessages.value = [
    ...aiMessages.value,
    {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCallSummary: [],
      timestamp: Date.now(),
    },
  ]

  const patch = (fn: (m: ChatMessage) => ChatMessage) => {
    aiMessages.value = aiMessages.value.map((m) => (m.id === assistantId ? fn(m) : m))
  }

  try {
    const body = {
      messages: aiMessages.value
        // Drop empty turns: a historical empty assistant message (from the
        // pre-fix silent-reply bug) would fail the server's content min(1)
        // validation and brick the chat for every subsequent send. The
        // just-appended streaming placeholder is empty too, so this also keeps
        // it out of its own request.
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      dayId: activeDay.value?.id,
    }

    const res = await fetch(`/api/trips/${tripId}/discuss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      // Pre-flight rejection (429 limit, 400 injection) — no stream was opened.
      const detail = await res.json().catch(() => null)
      throw new Error(
        (detail as { message?: string } | null)?.message ?? "AI is unavailable right now",
      )
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    let streamError = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const { frames, rest } = parseSseFrames(buf)
      buf = rest

      for (const frame of frames) {
        // Cast through the shared DiscussSseEvent union (shared/utils/discuss-sse.ts)
        // rather than an ad hoc literal per branch — a field rename on either side
        // (e.g. delta -> text) now breaks the build instead of silently reading
        // `undefined` at runtime. The `as` here is unavoidable: SSE payloads are
        // JSON.parse'd `unknown` and this is the only boundary where the network
        // meets the type system.
        const payload: unknown = JSON.parse(frame.data)
        if (frame.event === "tool") {
          const { line } = payload as Extract<DiscussSseEvent, { event: "tool" }>["data"]
          patch((m) => ({ ...m, toolCallSummary: [...(m.toolCallSummary ?? []), line] }))
        } else if (frame.event === "text") {
          const { delta } = payload as Extract<DiscussSseEvent, { event: "text" }>["data"]
          patch((m) => ({ ...m, content: m.content + delta }))
        } else if (frame.event === "done") {
          const donePayload = payload as Extract<DiscussSseEvent, { event: "done" }>["data"]
          const proposals: Proposal[] = donePayload.proposals
          patch((m) => ({
            ...m,
            content: donePayload.message,
            toolCallSummary: donePayload.toolCallSummary,
            proposals,
            proposalStates: Object.fromEntries(proposals.map((p) => [p.id, "pending" as const])),
          }))
        } else if (frame.event === "error") {
          streamError = (payload as Extract<DiscussSseEvent, { event: "error" }>["data"]).message
        }
      }
    }

    if (streamError) {
      dropEmptyAssistant(assistantId)
      aiMessages.value = [
        ...aiMessages.value,
        {
          id: makeMessageId(),
          role: "system",
          content: streamError,
          timestamp: Date.now(),
        },
      ]
    }
  } catch (e: unknown) {
    // User cancelled — keep whatever already streamed, add no error line.
    if (controller.signal.aborted) {
      dropEmptyAssistant(assistantId)
      return
    }
    dropEmptyAssistant(assistantId)
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: makeMessageId(),
        role: "system",
        content: e instanceof Error ? e.message : "AI failed",
        timestamp: Date.now(),
      },
    ]
  } finally {
    aiChatLoading.value = false
    await refreshAiUsage()
  }
}

/**
 * Remove the streaming placeholder if it never received anything. An empty
 * assistant bubble renders as a blank row and is dead weight in the history.
 */
function dropEmptyAssistant(id: string) {
  aiMessages.value = aiMessages.value.filter(
    (m) => m.id !== id || m.content.trim().length > 0 || (m.proposals?.length ?? 0) > 0,
  )
}

function handleAiCancel() {
  aiAbort?.abort()
  aiChatLoading.value = false
}

function setProposalState(
  messageId: string,
  proposalId: string,
  state: "pending" | "applying" | "applied" | "dismissed",
) {
  aiMessages.value = aiMessages.value.map((m) => {
    if (m.id !== messageId) return m
    return {
      ...m,
      proposalStates: { ...m.proposalStates, [proposalId]: state },
    }
  })
}

function friendlyApplyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : ""
  if (/409/.test(msg))
    return "That change no longer fits the day — it may have changed since. Refresh and try again."
  if (/422/.test(msg)) return "Couldn't find that place on Google Maps."
  return "Couldn't apply that change. Please try again."
}

async function applyOneProposal(
  messageId: string,
  proposal: Proposal,
): Promise<{ ok: boolean; message?: string; enrichmentFailures: number }> {
  const day = trip.value?.days.find((d) => d.id === proposal.dayId)
  if (day)
    // The day row is passed so a set-accommodation proposal can be undone —
    // without it, Undo restores activities and reports success while leaving
    // the accommodation changed.
    snapshotDay(
      proposal.dayId,
      day.activities.map((a) => ({ ...a })),
      day,
    )
  setProposalState(messageId, proposal.id, "applying")
  try {
    const result = await $fetch<{ message?: string; enrichmentFailures?: number }>(
      `/api/trips/${tripId}/proposals/apply`,
      { method: "POST", body: { proposal } },
    )
    setProposalState(messageId, proposal.id, "applied")
    return {
      ok: true as const,
      message: result.message,
      enrichmentFailures: result.enrichmentFailures ?? 0,
    }
  } catch (e: unknown) {
    setProposalState(messageId, proposal.id, "pending")
    toastError(friendlyApplyError(e))
    return { ok: false as const, message: undefined, enrichmentFailures: 0 }
  }
}

async function handleAiApplyProposal(messageId: string, proposal: Proposal) {
  if (proposal.kind === "remove-activities") {
    const ok = await confirm({
      title: "Remove activities?",
      message: `This removes ${proposal.payload.activityIds.length} stop(s) from ${dayLabels.value[proposal.dayId] ?? "the day"}. You can undo.`,
      confirmText: "Remove",
      destructive: true,
    })
    if (!ok) return
  }
  const res = await applyOneProposal(messageId, proposal)
  await refresh()
  if (res.ok) {
    // Take the user to the day that changed — a proposal can target a day
    // other than the one on screen, so otherwise the apply looks like a no-op.
    if (proposal.dayId !== activeDayId.value) activeDayId.value = proposal.dayId
    const dayLabel = dayLabels.value[proposal.dayId] ?? "the day"
    toastWithAction(
      res.enrichmentFailures > 0
        ? (res.message ?? "Some places couldn't be located.")
        : `Applied to ${dayLabel}.`,
      { label: "Undo", onClick: () => handleAiUndo(proposal.dayId) },
    )
  }
}

async function handleAiApplyGroup(messageId: string, proposals: Proposal[]) {
  const dayIds = [...new Set(proposals.map((p) => p.dayId))]
  const hasRemove = proposals.some((p) => p.kind === "remove-activities")
  if (dayIds.length >= 3 || hasRemove) {
    const ok = await confirm({
      title: "Apply all changes?",
      message: `This applies ${proposals.length} change(s) across ${dayIds.length} day(s). You can undo per day.`,
      confirmText: "Apply all",
      destructive: hasRemove,
    })
    if (!ok) return
  }
  let applied = 0
  let locateFailures = 0
  const changedDayIds = new Set<string>()
  for (const p of proposals) {
    const res = await applyOneProposal(messageId, p)
    if (res.ok) {
      applied++
      changedDayIds.add(p.dayId)
    }
    locateFailures += res.enrichmentFailures
  }
  await refresh()
  const changedDays = [...changedDayIds]
  // If the day on screen wasn't one that changed, jump to a changed day so
  // the additions are actually visible instead of looking like nothing happened.
  if (changedDays.length && !changedDays.includes(activeDayId.value ?? "")) {
    activeDayId.value = changedDays[0]!
  }
  const failed = proposals.length - applied
  const dayNames = changedDays.map((d) => dayLabels.value[d] ?? "a day").join(", ")
  const summary =
    applied === 0
      ? "Nothing could be applied."
      : failed === 0
        ? `Applied across ${dayNames}.`
        : `Applied ${applied} (${dayNames}); ${failed} couldn't be applied.`
  toastWithAction(
    locateFailures > 0 ? `${summary} ${locateFailures} place(s) couldn't be located.` : summary,
    { label: "Undo all", onClick: () => changedDays.forEach((d) => handleAiUndo(d)) },
    applied > 0 && failed === 0 ? "success" : "info",
  )
}

function handleAiDismissGroup(messageId: string, proposalIds: string[]) {
  proposalIds.forEach((id) => setProposalState(messageId, id, "dismissed"))
}

function handleAiDismissProposal(messageId: string, proposalId: string) {
  setProposalState(messageId, proposalId, "dismissed")
}

async function handleAiUndo(dayId: string) {
  try {
    const ok = await restoreDay(dayId)
    if (ok) {
      await refresh()
      toastSuccess("Reverted.")
    }
  } catch {
    toastError("Couldn't undo. Please try again.")
  }
}

async function handleQuickFillGaps() {
  if (!activeDay.value) return
  const dayId = activeDay.value.id
  snapshotDay(
    dayId,
    activeDay.value.activities.map((a) => ({ ...a })),
    activeDay.value,
  )
  aiMutating.value = true
  try {
    const data = await $fetch<{ message: string }>(`/api/trips/${tripId}/days/${dayId}/ai`, {
      method: "POST",
      body: { prompt: "Fill the gaps in this day", intent: "fill_gaps" },
    })
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: makeMessageId(),
        role: "system",
        content: data.message ?? "Filled gaps.",
        timestamp: Date.now(),
      },
    ]
    await refresh()
    toastWithAction("Gaps filled.", {
      label: "Undo",
      onClick: () => handleAiUndo(dayId),
    })
  } catch (e: unknown) {
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: makeMessageId(),
        role: "system",
        content: e instanceof Error ? e.message : "Fill gaps failed",
        timestamp: Date.now(),
      },
    ]
  } finally {
    aiMutating.value = false
    await refreshAiUsage()
  }
}

// "Optimize route" is a canned chat turn, not a separate one-click mutation, so
// it gets the discuss agent's full route logic: it reorders when that helps,
// and when a stop is stranded far from where the traveler sleeps (which no
// reordering can fix) it presents the real options and lets them choose —
// exactly what typing the request in the chat would do. Changes arrive as
// proposals the traveler applies, so there's one behaviour, not two.
async function handleQuickOptimizeRoute() {
  if (!activeDay.value || aiChatLoading.value) return
  await handleAiSubmit(
    "Optimize the route for this day — reorder the stops to minimise travel time and remove any back-and-forth. If a stop is stranded far from where I sleep tonight, lay out my options instead of forcing it.",
  )
}

async function handleGenerateFullItinerary() {
  aiMutating.value = true
  try {
    const didRun = await runFullItinerary(sortedDays.value, aiUsage.value?.remaining ?? undefined)
    if (!didRun) return

    if (generateNoticeMessage.value) {
      aiMessages.value = [
        ...aiMessages.value,
        {
          id: makeMessageId(),
          role: "system",
          content: generateNoticeMessage.value,
          timestamp: Date.now(),
        },
      ]
    }
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: makeMessageId(),
        role: "system",
        content: generateErrorMessage.value || "Generated full itinerary.",
        timestamp: Date.now(),
      },
    ]
    await refresh()
  } catch (e: unknown) {
    aiMessages.value = [
      ...aiMessages.value,
      {
        id: makeMessageId(),
        role: "system",
        content: e instanceof Error ? e.message : "Generate failed",
        timestamp: Date.now(),
      },
    ]
  } finally {
    aiMutating.value = false
    await refreshAiUsage()
  }
}

function handleAiClose() {
  // Just collapse the dock — keep the conversation in memory for when it reopens.
}

// Clear the AI thread (and any pending proposals) when the trip changes.
watch(
  () => route.params.id,
  () => {
    aiMessages.value = []
  },
)

async function handleAiClear() {
  const hasPending = aiMessages.value.some((m) =>
    Object.values(m.proposalStates ?? {}).includes("pending"),
  )
  if (hasPending) {
    const ok = await confirm({
      title: "Clear conversation?",
      message: "Unapplied suggestions will be lost.",
      confirmText: "Clear",
    })
    if (!ok) return
  }
  aiMessages.value = []
  aiInput.value = ""
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
    toastError("Could not save the day notes. Please try again.")
  }
}

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

  savingActivity.value = true
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
    toastError("Could not save your changes. Please try again.")
  } finally {
    savingActivity.value = false
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
    toastError("Could not delete the activity. Please try again.")
  }
}

function handleActivityClick(activity: TripActivity) {
  highlightedActivityId.value = activity.id
  if (tripMapRef.value && activity.lat && activity.lng) {
    tripMapRef.value.centerOnActivity(activity)
  }
}

function handleAccommodationFocus(point: { lat: number; lng: number }) {
  if (tripMapRef.value) {
    tripMapRef.value.centerOnPoint(point)
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

function handleActivityAdded(payload: {
  activity: TripActivity
  segments: TripDay["travelSegments"]
  dayId: string
}) {
  if (!trip.value) return
  const day = trip.value.days.find((d) => d.id === payload.dayId)
  if (!day) return
  day.activities = [...day.activities, payload.activity]
  day.travelSegments = payload.segments
}

const showMoreMenu = ref(false)
const showShareMenu = ref(false)

function handleTripUpdated(updated: unknown) {
  if (!updated) return
  // Server returns the same shape as GET /api/trips/[id] minus the _role field.
  // Preserve the current _role from the existing trip.value.
  const role = trip.value?._role
  trip.value = { ...(updated as TripResponse), _role: role ?? "owner" }
}

// Close menus on click outside
if (import.meta.client) {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    if (showMoreMenu.value && !target.closest(".relative")) {
      showMoreMenu.value = false
    }
    if (showShareMenu.value && !target.closest(".relative")) {
      showShareMenu.value = false
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
    toastError("Could not update the share link. Please try again.")
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
    <SkeletonTripDetail v-if="status === 'pending'" />

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
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 items-start gap-2">
          <NuxtLink
            to="/dashboard"
            class="mt-1 shrink-0 rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
          >
            <Icon name="lucide:arrow-left" class="h-5 w-5" />
          </NuxtLink>
          <div class="min-w-0">
            <h1 class="truncate font-display text-2xl text-sand-900 sm:text-3xl">
              {{ tripDisplayName }}
            </h1>
            <button
              v-if="!trip.countryCode && !isViewer"
              type="button"
              class="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-terra-50 px-2.5 py-1 text-xs font-medium text-terra-700 transition hover:bg-terra-100"
              @click="openSettings('country')"
            >
              <Icon name="lucide:map-pin" class="h-3.5 w-3.5" />
              Set a destination
            </button>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-0.5">
          <button
            v-if="!isViewer"
            type="button"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-800 focus-ring"
            title="Trip settings"
            aria-label="Trip settings"
            @click="showSettingsSheet ? (showSettingsSheet = false) : openSettings()"
          >
            <Icon name="lucide:sliders-horizontal" class="h-4 w-4" />
          </button>

          <template v-if="tripRole === 'owner'">
            <button
              v-if="!trip.shareToken"
              type="button"
              :disabled="shareLoading"
              class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-800 disabled:opacity-50 focus-ring"
              title="Generate share link"
              aria-label="Generate share link"
              @click="handleToggleShare"
            >
              <Icon
                :name="shareLoading ? 'lucide:loader' : 'lucide:share-2'"
                class="h-4 w-4"
                :class="{ 'animate-spin': shareLoading }"
              />
            </button>
            <div v-else class="relative">
              <button
                type="button"
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ocean-600 transition hover:bg-ocean-50 focus-ring"
                :title="shareCopied ? 'Copied!' : 'Share options'"
                :aria-label="shareCopied ? 'Share link copied' : 'Share options'"
                aria-haspopup="menu"
                :aria-expanded="showShareMenu"
                @click="showShareMenu = !showShareMenu"
              >
                <Icon :name="shareCopied ? 'lucide:check' : 'lucide:link'" class="h-4 w-4" />
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
                  v-if="showShareMenu"
                  class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-sand-700 hover:bg-sand-50"
                    @click="
                      () => {
                        handleCopyShareLink()
                        showShareMenu = false
                      }
                    "
                  >
                    <Icon name="lucide:copy" class="h-4 w-4 text-sand-400" />
                    Copy link
                  </button>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                    @click="
                      () => {
                        handleToggleShare()
                        showShareMenu = false
                      }
                    "
                  >
                    <Icon name="lucide:link-2-off" class="h-4 w-4" />
                    Revoke link
                  </button>
                </div>
              </Transition>
            </div>
          </template>

          <div class="relative">
            <button
              type="button"
              class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-800 focus-ring"
              title="More options"
              aria-label="More options"
              aria-haspopup="menu"
              :aria-expanded="showMoreMenu"
              @click="showMoreMenu = !showMoreMenu"
            >
              <Icon name="lucide:more-horizontal" class="h-4 w-4" />
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
                  type="button"
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
                  type="button"
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
        </div>
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
          :trip-id="tripId"
          :sorted-days="sortedDays"
          :summary="expenseSummary ?? null"
          :currency-code="trip.currencyCode ?? 'USD'"
          :airports="tripAirports"
          @navigate-to-day="handleNavigateToDay"
          @refreshed="refresh"
        />
      </div>

      <div v-else-if="activeTab === 'itinerary'" class="mt-6">
        <!-- Day strip + controls in one band -->
        <div class="flex items-center gap-3">
          <ClientOnly>
            <div
              ref="dayStripRef"
              class="-mx-1 min-w-0 flex-1 overflow-x-auto px-1 pb-1 scrollbar-hide"
            >
              <div class="flex min-w-max items-center gap-1">
                <template v-for="(week, weekIdx) in dayWeeks" :key="weekIdx">
                  <div
                    v-if="weekIdx > 0"
                    class="mx-1.5 h-8 w-px shrink-0 bg-sand-200/70 dark:bg-white/10"
                    aria-hidden="true"
                  />
                  <button
                    v-for="day in week"
                    :key="day.id"
                    :data-day-id="day.id"
                    type="button"
                    class="relative flex h-12 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra-400"
                    :class="
                      day.id === activeDayId
                        ? 'bg-terra-500 text-white shadow-sm shadow-terra-500/30'
                        : day.date === todayDate
                          ? 'text-terra-600 hover:bg-sand-100'
                          : 'text-sand-600 hover:bg-sand-100'
                    "
                    @click="activeDayId = day.id"
                  >
                    <NuxtTime
                      class="font-display text-base leading-none tabular-nums"
                      :datetime="day.date + 'T00:00:00'"
                      locale="en-US"
                      day="numeric"
                    />
                    <NuxtTime
                      class="text-[9px] font-medium uppercase tracking-[0.12em] opacity-70"
                      :datetime="day.date + 'T00:00:00'"
                      locale="en-US"
                      weekday="short"
                    />
                    <span
                      v-if="day.date === todayDate && day.id !== activeDayId"
                      class="absolute bottom-1 h-1 w-1 rounded-full bg-terra-500"
                      aria-hidden="true"
                    />
                  </button>
                </template>
              </div>
            </div>
          </ClientOnly>

          <div class="h-8 w-px shrink-0 bg-sand-200/70 dark:bg-white/10" aria-hidden="true" />

          <div class="flex shrink-0 items-center gap-2 sm:gap-3">
            <div
              class="flex items-center gap-0.5 rounded-lg bg-sand-100/60 p-0.5 dark:bg-white/[0.04]"
            >
              <button
                v-for="mode in transportModeOptions"
                :key="mode.value"
                type="button"
                :disabled="transportUpdating"
                :title="`${mode.label} travel time`"
                :aria-label="`Use ${mode.label.toLowerCase()} travel times`"
                :aria-pressed="activeTransportMode === mode.value"
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md transition disabled:opacity-50 focus-ring"
                :class="
                  activeTransportMode === mode.value
                    ? 'bg-terra-500 text-white shadow-sm'
                    : 'text-sand-500 hover:bg-sand-200/60 hover:text-sand-700'
                "
                @click="handleTransportModeChange(mode.value)"
              >
                <Icon :name="mode.icon" class="h-3.5 w-3.5" />
              </button>
            </div>

            <a
              v-if="activeDayMapsUrl"
              :href="activeDayMapsUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="hidden items-center gap-1.5 text-xs font-medium text-sand-500 transition hover:text-terra-600 md:inline-flex"
              title="Open this day's route in Google Maps"
            >
              <Icon name="lucide:navigation" class="h-3.5 w-3.5" />
              Open in Maps
            </a>
            <a
              v-if="activeDayMapsUrl"
              :href="activeDayMapsUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sand-500 transition hover:bg-sand-100 hover:text-terra-600 md:hidden focus-ring"
              :title="`Open this day's route in Google Maps`"
              :aria-label="`Open this day's route in Google Maps`"
            >
              <Icon name="lucide:navigation" class="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <!-- Active day content -->
        <div v-if="activeDay" class="mt-4">
          <div class="flex flex-col gap-6 lg:flex-row">
            <!-- Left: Ideas + Accommodation + Activities -->
            <div
              class="flex-1 space-y-4 pb-24 lg:max-h-[calc(100vh-320px)] lg:overflow-y-auto lg:pr-4 lg:pb-6 scrollbar-thin"
            >
              <!-- Ideas bucket (hidden for viewers) -->
              <IdeasBucket
                v-if="!isViewer"
                :trip-id="tripId"
                :ideas="ideas ?? []"
                :days="sortedDays.map((d) => ({ id: d.id, dayNumber: d.dayNumber, date: d.date }))"
                :active-day-id="activeDayId"
                @refresh="handleIdeasRefresh"
              />

              <!-- Accommodation (hidden for viewers) -->
              <AccommodationSection
                v-if="!isViewer"
                ref="accommodationSectionRef"
                :trip-id="tripId"
                :day-id="activeDay.id"
                :accommodation-name="activeDay.accommodationName"
                :accommodation-address="activeDay.accommodationAddress"
                :accommodation-lat="activeDay.accommodationLat"
                :accommodation-lng="activeDay.accommodationLng"
                :accommodation-place-id="activeDay.accommodationPlaceId"
                :previous-stay-name="activeDayStartLocation?.name ?? null"
                :arrival-flight="activeDayArrivalFlight"
                :departure-flight="activeDayDepartureFlight"
                @focus-map="handleAccommodationFocus"
                :days="
                  sortedDays.map((d) => ({
                    id: d.id,
                    dayNumber: d.dayNumber,
                    date: d.date,
                    accommodationName: d.accommodationName,
                  }))
                "
                @updated="refresh"
              />

              <!-- Activities for this day. During a mutating AI flow (fill /
                   optimize / generate) the list stays VISIBLE but dims and locks
                   so the user never watches their day go blank mid-rewrite — the
                   map keeps showing the same stops, so the two panels agree. -->
              <div class="relative">
                <div
                  v-if="aiMutating"
                  class="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-full bg-sand-900/85 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-sand-50"
                >
                  <Icon name="lucide:loader-2" class="h-3 w-3 animate-spin" />
                  Updating
                </div>
                <div
                  class="transition-opacity duration-200"
                  :class="{ 'pointer-events-none select-none opacity-60': aiMutating }"
                  :aria-busy="aiMutating || undefined"
                >
                  <DaySection
                    :key="activeDay.id"
                    :day="activeDay"
                    :trip-id="tripId"
                    :currency-code="trip?.currencyCode ?? 'USD'"
                    :highlighted-activity-id="highlightedActivityId"
                    :travel-segments="activeDay.travelSegments"
                    :travel-mode="activeTransportMode"
                    :readonly="isViewer || aiMutating"
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
                </div>
              </div>
            </div>

            <!-- Right: Map -->
            <div class="order-first lg:order-none lg:w-[480px] lg:shrink-0">
              <div
                class="h-[250px] overflow-hidden rounded-2xl shadow-lg sm:h-[300px] lg:sticky lg:top-8 lg:h-[calc(100vh-320px)]"
              >
                <TripMap
                  ref="tripMapRef"
                  :activities="activeDayActivities"
                  :start-accommodation="activeDayStartLocation"
                  :end-accommodation="activeDayEndAccommodation"
                  :airports="activeDayAirports"
                  :country-code="trip?.countryCode ?? null"
                  @marker-click="handleMarkerClick"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Review tab -->
      <div v-else-if="activeTab === 'review'" class="mt-8 max-w-3xl">
        <ItineraryReviewPanel
          :trip-id="tripId"
          :days="sortedDays"
          initial-scope="trip"
          :initial-day-id="activeDayId ?? undefined"
          @fix="handleReviewFix"
        />
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
          :expenses="expensesList"
          :summary="expenseSummary ?? null"
          :activities="allActivities"
          :filters="expenseQuery"
          :filtered-count="expensePage?.filteredCount ?? 0"
          :filtered-total="expensePage?.filteredTotal ?? 0"
          :has-more="expenseCursor !== null"
          :loading-more="loadingMoreExpenses"
          @budget-updated="refresh"
          @expenses-changed="refreshExpenses"
          @update:filters="expenseQuery = $event"
          @load-more="loadMoreExpenses"
          @export-csv="exportExpensesCsv"
        />
      </div>

      <!-- Bookings tab -->
      <div v-else-if="activeTab === 'reservations'" class="mt-8 max-w-3xl">
        <ReservationTracker :trip-id="tripId" :currency-code="trip.currencyCode ?? 'USD'" />
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

        <LazyFlightGlobe v-if="sortedTripFlights.length > 0" :flights="sortedTripFlights" />

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
          <div class="min-w-0 flex-1 overflow-hidden">
            <label class="mb-1 block text-xs font-medium text-sand-600">Date</label>
            <input
              v-model="tripFlightDate"
              type="date"
              class="w-full appearance-none rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-sand-900 focus:border-terra-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            :disabled="addingTripFlight || !tripFlightNumber || !tripFlightDate"
            class="shrink-0 rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-terra-600 disabled:opacity-50"
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

    <!-- Trip settings sheet -->
    <TripSettingsSheet
      v-if="trip && !isViewer"
      :open="showSettingsSheet"
      :trip-id="tripId"
      :trip="trip"
      :currency-converting="currencyConverting"
      :focus-field="settingsFocusField"
      @close="showSettingsSheet = false"
      @update-preference="updatePreference"
      @change-currency="handleCurrencyChange"
      @trip-info-saved="handleTripUpdated"
    />

    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="generatingItinerary"
        class="pointer-events-none fixed left-1/2 top-20 z-[80] -translate-x-1/2 md:top-auto md:bottom-28"
        role="status"
        aria-live="polite"
      >
        <div
          class="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-sand-800 shadow-lg ring-1 ring-black/5"
        >
          <span class="size-2 animate-pulse rounded-full bg-terra-500" />
          <span class="truncate max-w-[70vw]">
            Generating {{ generatingDayLabel || `day ${generatingDayIndex + 1}` }}
            <span class="opacity-60"
              >({{ generatingDayIndex + 1 }} of {{ generatingDayTotal }})</span
            >
          </span>
        </div>
      </div>
    </Transition>

    <!-- AI dock -->
    <AiDock
      v-if="trip && activeTab === 'itinerary' && activeDay && !isViewer"
      v-model:input="aiInput"
      :messages="aiMessages"
      :loading="aiLoading"
      :usage-used="aiUsage?.used ?? null"
      :usage-limit="aiUsage?.limit ?? null"
      :usage-remaining="aiUsage?.remaining ?? null"
      :has-activities="activeDayHasActivities"
      :destination="trip.destination"
      :starters="aiStarters"
      :day-labels="dayLabels"
      @submit="handleAiSubmit"
      @apply-proposal="handleAiApplyProposal"
      @dismiss-proposal="handleAiDismissProposal"
      @apply-group="handleAiApplyGroup"
      @dismiss-group="handleAiDismissGroup"
      @undo="handleAiUndo"
      @cancel="handleAiCancel"
      @fill-gaps="handleQuickFillGaps"
      @optimize-route="handleQuickOptimizeRoute"
      @generate-full="handleGenerateFullItinerary"
      @close="handleAiClose"
      @clear="handleAiClear"
    />

    <!-- Edit modal -->
    <LazyEditActivityModal
      :activity="editingActivity"
      :open="editModalOpen"
      :currency-code="trip?.currencyCode ?? 'USD'"
      :saving="savingActivity"
      @save="handleSaveActivity"
      @close="editModalOpen = false"
    />

    <!-- Add activity modal -->
    <LazyAddActivityModal
      :open="addActivityModal.open"
      :trip-id="tripId"
      :day-id="addActivityModal.dayId"
      :day-number="addActivityModal.dayNumber"
      @added="handleActivityAdded"
      @close="addActivityModal.open = false"
    />
  </div>
</template>
