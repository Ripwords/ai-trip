<script setup lang="ts">
interface Activity {
  id: string
  name: string
  type: string
  description: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  address: string | null
  rating: string | null
  priceLevel: number | null
  suggestedTime: string | null
  estimatedDurationMinutes: number | null
  costEstimate: string | null
  notes: string | null
  actualCost: string | null
  photos: string[] | null
  openingHours: string[] | null
  tags: string[]
  sortOrder: number
}

interface PlaceDetails {
  photos?: string[]
}

const placeDetailsCache = new Map<string, Promise<PlaceDetails | null>>()

function formatPriceLevel(level: number): string {
  return "$".repeat(Math.min(level, 4))
}

function getGoogleMapsUrl(activity: Activity): string {
  // Use query_place_id for precise matching, with query as fallback display
  // The api=1 format works cross-platform (iOS, Android, web)
  if (activity.placeId && activity.lat && activity.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}&query_place_id=${activity.placeId}`
  }
  if (activity.lat && activity.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}`
  }
  if (activity.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address)}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name)}`
}

interface Participant {
  userId: string
  name: string
  image: string | null
}

interface Member {
  userId: string
  user: { name: string; image: string | null }
}

const props = defineProps<{
  activity: Activity
  index: number
  highlighted?: boolean
  readonly?: boolean
  isCollaborative?: boolean
  voteCount?: number
  commentCount?: number
  participants?: Participant[]
  members?: Member[]
}>()

const emit = defineEmits<{
  edit: [activity: Activity]
  delete: [activity: Activity]
  click: [activity: Activity]
  vote: [activityId: string, vote: "up" | "down"]
  showComments: [activityId: string]
  toggleParticipant: [activityId: string, userId: string]
}>()

const showParticipantPicker = ref(false)
const cardRef = ref<HTMLElement | null>(null)
const loadedPlacePhotos = ref<string[]>([])
const detailsLoading = ref(false)
const imageFailed = ref(false)
let visibilityObserver: IntersectionObserver | null = null

const resolvedPhotos = computed(() =>
  props.activity.photos?.length ? props.activity.photos : loadedPlacePhotos.value,
)

function getPhotoPlaceId(photo: string): string | null {
  return props.activity.placeId ?? photo.match(/^places\/([^/?#]+)\/photos\/[^/?#]+$/)?.[1] ?? null
}

const thumbnailUrl = computed(() => {
  const photo = resolvedPhotos.value[0]
  if (!photo || imageFailed.value) return null

  const placeId = getPhotoPlaceId(photo)
  if (!placeId) return null

  const params = new URLSearchParams({
    photo,
    maxWidthPx: "240",
  })
  return `/api/places/${encodeURIComponent(placeId)}/photo?${params.toString()}`
})

async function loadPlacePhotos() {
  const placeId = props.activity.placeId
  if (
    !placeId ||
    props.activity.photos?.length ||
    loadedPlacePhotos.value.length ||
    detailsLoading.value
  ) {
    return
  }

  detailsLoading.value = true
  try {
    if (!placeDetailsCache.has(placeId)) {
      placeDetailsCache.set(
        placeId,
        $fetch<PlaceDetails>(`/api/places/${encodeURIComponent(placeId)}/details`),
      )
    }

    const details = await placeDetailsCache.get(placeId)
    loadedPlacePhotos.value = details?.photos ?? []
  } catch {
    loadedPlacePhotos.value = []
  } finally {
    detailsLoading.value = false
  }
}

onMounted(() => {
  if (props.activity.photos?.length || !props.activity.placeId) return

  if (!("IntersectionObserver" in window) || !cardRef.value) {
    void loadPlacePhotos()
    return
  }

  visibilityObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      visibilityObserver?.disconnect()
      visibilityObserver = null
      void loadPlacePhotos()
    },
    { rootMargin: "200px" },
  )

  visibilityObserver.observe(cardRef.value)
})

onBeforeUnmount(() => {
  visibilityObserver?.disconnect()
})

watch(
  () => props.activity.id,
  () => {
    loadedPlacePhotos.value = []
    imageFailed.value = false
    void loadPlacePhotos()
  },
)

function isParticipant(userId: string): boolean {
  return props.participants?.some((p) => p.userId === userId) ?? false
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

const typeBadgeClasses: Record<string, string> = {
  attraction: "bg-ocean-50 text-ocean-700",
  restaurant: "bg-terra-50 text-terra-700",
  hotel: "bg-ocean-50 text-ocean-700",
  transport: "bg-sand-100 text-sand-700",
  shopping: "bg-terra-50 text-terra-600",
  entertainment: "bg-forest-50 text-forest-700",
  park: "bg-forest-50 text-forest-700",
  nature: "bg-forest-50 text-forest-700",
}

function getBadgeClass(type: string): string {
  return typeBadgeClasses[type] || "bg-sand-100 text-sand-700"
}

const typeDotClasses: Record<string, string> = {
  attraction: "bg-ocean-500",
  restaurant: "bg-terra-500",
  hotel: "bg-ocean-500",
  transport: "bg-sand-500",
  shopping: "bg-terra-400",
  entertainment: "bg-forest-500",
  park: "bg-forest-500",
  nature: "bg-forest-500",
}

function getDotClass(type: string): string {
  return typeDotClasses[type] || "bg-sand-500"
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

function starFill(rating: string | null, position: number): "full" | "half" | "empty" {
  if (!rating) return "empty"
  const val = parseFloat(rating)
  if (position <= Math.floor(val)) return "full"
  if (position === Math.floor(val) + 1 && val % 1 >= 0.25) return "half"
  return "empty"
}
</script>

<template>
  <div
    ref="cardRef"
    class="group relative overflow-hidden rounded-2xl border bg-white transition cursor-pointer hover:shadow-md"
    :class="
      highlighted
        ? 'border-terra-500 bg-terra-50 shadow-md'
        : 'border-sand-200 hover:border-sand-300'
    "
    @click="emit('click', activity)"
  >
    <!-- ─────────────────────────── MOBILE HERO ─────────────────────────── -->
    <div class="relative sm:hidden">
      <div class="aspect-[16/10] w-full overflow-hidden bg-sand-100">
        <img
          v-if="thumbnailUrl"
          :src="thumbnailUrl"
          :alt="activity.name"
          class="h-full w-full object-cover transition duration-500 group-active:scale-105"
          loading="lazy"
          @error="imageFailed = true"
        />
        <div v-else class="flex h-full w-full items-center justify-center text-sand-300">
          <Icon
            :name="detailsLoading ? 'lucide:loader' : 'lucide:image'"
            class="h-10 w-10"
            :class="{ 'animate-spin': detailsLoading }"
          />
        </div>
      </div>

      <!-- Legibility gradient -->
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/65 via-black/20 to-transparent"
      ></div>
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/35 to-transparent"
      ></div>

      <!-- Number badge (top-left) -->
      <span
        class="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-terra-500 text-sm font-bold text-white shadow-md ring-2 ring-white/90"
      >
        {{ index + 1 }}
      </span>

      <!-- Mobile drag handle — long-press to reorder.
           Anchored next to the number badge (left side) so a long type pill on the right
           can't collide with it. -->
      <button
        v-if="!readonly"
        class="drag-handle absolute left-13 top-3.5 flex h-7 w-7 cursor-grab items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-md active:cursor-grabbing active:bg-black/65"
        :title="'Hold to reorder'"
        @click.stop
      >
        <Icon name="lucide:grip-vertical" class="h-3.5 w-3.5" />
      </button>

      <!-- Type pill (top-right)
           Uses stone-* palette (not in the project's .dark CSS-var swap)
           and dodges the global `.dark .bg-white { ... !important }` override,
           so the pill stays near-white with dark text in BOTH themes. -->
      <span
        class="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-stone-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-stone-900 shadow-lg ring-1 ring-black/10"
      >
        <span
          class="inline-block h-1.5 w-1.5 rounded-full"
          :class="getDotClass(activity.type)"
        ></span>
        {{ formatType(activity.type) }}
      </span>

      <!-- Time + duration overlay (bottom) -->
      <div class="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
        <span
          v-if="activity.suggestedTime"
          class="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-terra-700 shadow-sm backdrop-blur"
        >
          <Icon name="lucide:clock" class="h-3 w-3" />
          {{ formatTime12h(activity.suggestedTime) }}
        </span>
        <span
          v-if="activity.estimatedDurationMinutes"
          class="inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur"
        >
          <Icon name="lucide:hourglass" class="h-3 w-3" />
          {{ formatDuration(activity.estimatedDurationMinutes) }}
        </span>
      </div>
    </div>

    <!-- ─────────────────────────── CONTENT ─────────────────────────── -->
    <div class="p-4 sm:p-5">
      <!-- Desktop header (≥sm) -->
      <div class="hidden sm:flex sm:items-start sm:justify-between sm:gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
          >
            {{ index + 1 }}
          </span>
          <div
            class="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sand-100 text-sand-300"
          >
            <img
              v-if="thumbnailUrl"
              :src="thumbnailUrl"
              :alt="activity.name"
              class="h-full w-full object-cover"
              loading="lazy"
              @error="imageFailed = true"
            />
            <Icon v-else-if="detailsLoading" name="lucide:loader" class="h-5 w-5 animate-spin" />
            <Icon v-else name="lucide:image" class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <h4 class="text-base font-semibold text-sand-900 truncate">
              {{ activity.name }}
            </h4>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <span
                class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                :class="getBadgeClass(activity.type)"
              >
                {{ formatType(activity.type) }}
              </span>
              <span
                v-if="activity.suggestedTime"
                class="inline-flex items-center gap-1 rounded-full bg-terra-50 px-2.5 py-0.5 text-xs font-semibold text-terra-700"
              >
                <Icon name="lucide:clock" class="h-3 w-3" />
                {{ formatTime12h(activity.suggestedTime) }}
              </span>
              <span v-if="activity.estimatedDurationMinutes" class="text-sm text-sand-500">
                {{ formatDuration(activity.estimatedDurationMinutes) }}
              </span>
            </div>
          </div>
        </div>

        <div
          v-if="!readonly"
          class="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition"
        >
          <button
            class="rounded-lg p-1.5 text-sand-400 hover:bg-terra-50 hover:text-terra-600"
            title="Edit"
            @click.stop="emit('edit', activity)"
          >
            <Icon name="lucide:edit" class="h-4 w-4" />
          </button>
          <button
            class="rounded-lg p-1.5 text-sand-400 hover:bg-red-50 hover:text-red-600"
            title="Delete"
            @click.stop="emit('delete', activity)"
          >
            <Icon name="lucide:trash-2" class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- Mobile title row (<sm) -->
      <div class="flex items-start justify-between gap-2 sm:hidden">
        <h4 class="text-[17px] font-bold leading-tight text-sand-900">
          {{ activity.name }}
        </h4>
        <div v-if="!readonly" class="-mr-1.5 -mt-1.5 flex shrink-0 gap-0.5">
          <button
            class="rounded-lg p-1.5 text-sand-400 active:bg-terra-50 active:text-terra-600"
            title="Edit"
            @click.stop="emit('edit', activity)"
          >
            <Icon name="lucide:edit" class="h-4 w-4" />
          </button>
          <button
            class="rounded-lg p-1.5 text-sand-400 active:bg-red-50 active:text-red-600"
            title="Delete"
            @click.stop="emit('delete', activity)"
          >
            <Icon name="lucide:trash-2" class="h-4 w-4" />
          </button>
        </div>
      </div>

      <p
        v-if="activity.description"
        class="mt-2 text-sm leading-relaxed text-sand-600 line-clamp-2"
      >
        {{ activity.description }}
      </p>

      <div v-if="activity.tags?.length" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="tag in activity.tags.slice(0, 4)"
          :key="tag"
          class="rounded-full bg-sand-100 px-2 py-0.5 text-[10px] text-sand-500"
        >
          {{ tag }}
        </span>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-sand-500">
        <a
          :href="getGoogleMapsUrl(activity)"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex min-w-0 max-w-full items-center gap-1.5 text-ocean-600 transition hover:text-terra-600"
          title="Open in Google Maps"
          @click.stop
        >
          <Icon name="lucide:map-pin" class="h-3.5 w-3.5 shrink-0" />
          <span
            v-if="activity.address"
            class="min-w-0 truncate underline decoration-ocean-300 underline-offset-2 hover:decoration-terra-400"
            >{{ activity.address }}</span
          >
          <span
            v-else
            class="truncate underline decoration-ocean-300 underline-offset-2 hover:decoration-terra-400"
            >View on map</span
          >
          <Icon name="lucide:external-link" class="h-3 w-3 shrink-0 opacity-50" />
        </a>
        <span v-if="activity.costEstimate" class="flex items-center gap-1">
          <Icon name="lucide:dollar-sign" class="h-3.5 w-3.5" />
          {{ parseFloat(activity.costEstimate).toFixed(0) }}
        </span>
        <span
          v-if="activity.priceLevel != null && activity.priceLevel > 0"
          class="text-xs font-medium text-forest-600"
        >
          {{ formatPriceLevel(activity.priceLevel) }}
        </span>
        <span
          v-if="activity.actualCost"
          class="flex items-center gap-1 text-forest-600 font-medium"
        >
          Paid: ${{ parseFloat(activity.actualCost).toFixed(0) }}
        </span>
        <span v-if="activity.notes" class="flex items-center gap-1" title="Has notes">
          <Icon name="lucide:sticky-note" class="h-3.5 w-3.5" />
        </span>
        <span v-if="activity.rating" class="flex items-center gap-0.5">
          <template v-for="i in 5" :key="i">
            <span v-if="starFill(activity.rating, i) === 'half'" class="relative h-3.5 w-3.5">
              <Icon name="lucide:star" class="absolute inset-0 h-3.5 w-3.5 text-sand-300" />
              <span class="absolute inset-0 overflow-hidden" style="width: 50%">
                <Icon name="mdi:star" class="h-3.5 w-3.5 text-terra-400" />
              </span>
            </span>
            <Icon
              v-else
              :name="starFill(activity.rating, i) === 'full' ? 'mdi:star' : 'lucide:star'"
              class="h-3.5 w-3.5"
              :class="starFill(activity.rating, i) === 'full' ? 'text-terra-400' : 'text-sand-300'"
            />
          </template>
          <span class="ml-1">{{ activity.rating }}</span>
        </span>
      </div>

      <!-- Participants -->
      <div v-if="members && members.length > 1" class="mt-2 flex items-center gap-1.5">
        <div class="flex -space-x-1.5">
          <span
            v-for="p in (participants ?? []).slice(0, 5)"
            :key="p.userId"
            class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white text-[8px] font-bold text-white"
            :style="{ background: '#E85D3A' }"
            :title="p.name"
          >
            {{ getInitials(p.name) }}
          </span>
        </div>
        <button
          v-if="!readonly"
          class="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-sand-300 text-sand-400 transition hover:border-terra-400 hover:text-terra-500"
          title="Assign members"
          @click.stop="showParticipantPicker = !showParticipantPicker"
        >
          <Icon name="lucide:user-plus" class="h-3 w-3" />
        </button>

        <!-- Participant picker dropdown -->
        <div
          v-if="showParticipantPicker"
          class="absolute z-20 mt-1 w-48 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
          style="top: 100%"
        >
          <button
            v-for="m in members"
            :key="m.userId"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-sand-50"
            @click.stop="
              () => {
                emit('toggleParticipant', activity.id, m.userId)
                showParticipantPicker = false
              }
            "
          >
            <span
              class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
              :style="{ background: isParticipant(m.userId) ? '#E85D3A' : '#a8a29e' }"
            >
              {{ getInitials(m.user.name) }}
            </span>
            <span class="text-sand-700">{{ m.user.name }}</span>
            <Icon
              v-if="isParticipant(m.userId)"
              name="lucide:check"
              class="ml-auto h-3.5 w-3.5 text-forest-600"
            />
          </button>
        </div>
      </div>

      <!-- Collaboration: vote + comment (only for group trips) -->
      <div
        v-if="isCollaborative"
        class="mt-3 flex items-center gap-3 border-t border-sand-100 pt-2"
      >
        <button
          class="inline-flex items-center gap-1 text-xs text-sand-400 transition hover:text-forest-600"
          title="Upvote"
          @click.stop="emit('vote', activity.id, 'up')"
        >
          <Icon name="lucide:thumbs-up" class="h-3.5 w-3.5" />
          <span v-if="voteCount">{{ voteCount }}</span>
        </button>
        <button
          class="inline-flex items-center gap-1 text-xs text-sand-400 transition hover:text-terra-600"
          title="Downvote"
          @click.stop="emit('vote', activity.id, 'down')"
        >
          <Icon name="lucide:thumbs-down" class="h-3.5 w-3.5" />
        </button>
        <button
          class="ml-auto inline-flex items-center gap-1 text-xs text-sand-400 transition hover:text-ocean-600"
          @click.stop="emit('showComments', activity.id)"
        >
          <Icon name="lucide:message-circle" class="h-3.5 w-3.5" />
          <span v-if="commentCount">{{ commentCount }}</span>
          <span v-else>Comment</span>
        </button>
      </div>
    </div>
  </div>
</template>
