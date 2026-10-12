<script setup lang="ts">
import type { VoteState } from "~/utils/activity-votes"

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
  currencyCode?: string
  highlighted?: boolean
  readonly?: boolean
  isCollaborative?: boolean
  votes?: VoteState
  /** Undefined until the thread has been opened once; the list has no count. */
  commentCount?: number
  commentsOpen?: boolean
  participants?: Participant[]
  members?: Member[]
}>()

const { format: formatCurrency } = useCurrencyFormat(() => props.currencyCode)

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

const tags = computed(() => visibleTags(props.activity.tags))
const canAssign = computed(() => (props.members?.length ?? 0) > 1)

// ── Overflow menu: edit / assign / delete ────────────────────────────
// One trigger instead of three always-visible buttons. Keyboard: Enter/Space
// opens it on the first item, arrows/Home/End move, Esc or Tab closes.
const menuOpen = ref(false)
const menuWrapRef = ref<HTMLElement | null>(null)
const menuTriggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuId = useId()
const pickerWrapRef = ref<HTMLElement | null>(null)

function menuItems(): HTMLElement[] {
  return Array.from(menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

function focusMenuItem(index: number) {
  const items = menuItems()
  if (items.length === 0) return
  items[(index + items.length) % items.length]?.focus()
}

function openMenu() {
  showParticipantPicker.value = false
  menuOpen.value = true
  nextTick(() => focusMenuItem(0))
}

function closeMenu(returnFocus: boolean) {
  menuOpen.value = false
  if (returnFocus) menuTriggerRef.value?.focus()
}

function toggleMenu() {
  if (menuOpen.value) closeMenu(true)
  else openMenu()
}

function onMenuKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (!menuOpen.value) return
    e.preventDefault()
    closeMenu(true)
    return
  }
  if (!menuOpen.value) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      openMenu()
    }
    return
  }
  const current = menuItems().indexOf(document.activeElement as HTMLElement)
  if (e.key === "ArrowDown") {
    e.preventDefault()
    focusMenuItem(current + 1)
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    focusMenuItem(current < 0 ? -1 : current - 1)
  } else if (e.key === "Home") {
    e.preventDefault()
    focusMenuItem(0)
  } else if (e.key === "End") {
    e.preventDefault()
    focusMenuItem(-1)
  } else if (e.key === "Tab") {
    closeMenu(false)
  }
}

function menuAction(action: "edit" | "assign" | "delete") {
  closeMenu(action !== "assign")
  if (action === "edit") emit("edit", props.activity)
  else if (action === "delete") emit("delete", props.activity)
  else showParticipantPicker.value = true
}

function onPickerKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return
  e.preventDefault()
  showParticipantPicker.value = false
  menuTriggerRef.value?.focus()
}

function onDocumentPointerDown(e: PointerEvent) {
  const target = e.target as Node | null
  if (menuOpen.value && target && !menuWrapRef.value?.contains(target)) closeMenu(false)
  if (showParticipantPicker.value && target && !pickerWrapRef.value?.contains(target)) {
    showParticipantPicker.value = false
  }
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown))
onUnmounted(() => document.removeEventListener("pointerdown", onDocumentPointerDown))

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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m} min` : `${h}h`
}
</script>

<template>
  <div
    ref="cardRef"
    role="button"
    tabindex="0"
    :aria-label="`Focus ${activity.name} on the map`"
    class="group relative rounded-2xl border bg-white transition cursor-pointer hover:shadow-md focus-ring"
    :class="
      highlighted
        ? 'border-terra-500 bg-terra-50 shadow-md'
        : 'border-sand-200 hover:border-sand-300'
    "
    @click="emit('click', activity)"
    @keydown.enter.prevent="emit('click', activity)"
    @keydown.space.prevent="emit('click', activity)"
  >
    <!-- ─────────────────────────── CONTENT ─────────────────────────── -->
    <!-- Hero image block removed — Place Photos API was the dominant cost
         driver and the placeholder was wasting vertical space. Number,
         drag handle, type, time, and duration all live in the content
         area now. -->
    <div class="p-4 sm:p-5">
      <!-- Meta row: number + drag (left), type pill (right) -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span
            class="flex h-7 w-7 items-center justify-center rounded-full bg-cta text-xs font-bold text-white shadow-sm"
          >
            {{ index + 1 }}
          </span>
          <!-- 28px circle is the right visual weight next to the step number, but
               it is well under the 44px touch minimum. Extend the hit area with a
               transparent pseudo-element instead of growing the dot. -->
          <button
            v-if="!readonly"
            class="drag-handle relative flex h-7 w-7 cursor-grab items-center justify-center rounded-full bg-sand-100 text-sand-500 transition before:absolute before:-inset-2 before:content-[''] hover:bg-sand-200 active:cursor-grabbing"
            title="Drag to reorder"
            @click.stop
          >
            <Icon name="lucide:grip-vertical" class="h-3.5 w-3.5" />
          </button>
        </div>
        <span
          class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
          :class="getBadgeClass(activity.type)"
        >
          {{ formatType(activity.type) }}
        </span>
      </div>

      <!-- Title row -->
      <div class="mt-3 flex items-start justify-between gap-2">
        <h4 class="text-[17px] font-bold leading-tight text-sand-900 sm:text-base">
          {{ activity.name }}
        </h4>
        <div
          v-if="!readonly"
          ref="menuWrapRef"
          class="relative -mr-1.5 -mt-1.5 shrink-0"
          @click.stop
          @keydown.stop="onMenuKeydown"
        >
          <button
            ref="menuTriggerRef"
            type="button"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 focus-ring"
            :aria-label="`Actions for ${activity.name}`"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            :aria-controls="menuOpen ? menuId : undefined"
            @click="toggleMenu"
          >
            <Icon name="lucide:ellipsis" class="h-4 w-4" />
          </button>
          <div
            v-if="menuOpen"
            :id="menuId"
            ref="menuRef"
            role="menu"
            :aria-label="`Actions for ${activity.name}`"
            class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-sand-700 hover:bg-sand-50 focus:bg-sand-50 focus:outline-none"
              @click="menuAction('edit')"
            >
              <Icon name="lucide:edit" class="h-4 w-4 text-sand-400" />
              Edit
            </button>
            <button
              v-if="canAssign"
              type="button"
              role="menuitem"
              tabindex="-1"
              class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-sand-700 hover:bg-sand-50 focus:bg-sand-50 focus:outline-none"
              @click="menuAction('assign')"
            >
              <Icon name="lucide:user-plus" class="h-4 w-4 text-sand-400" />
              Assign people
            </button>
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
              @click="menuAction('delete')"
            >
              <Icon name="lucide:trash-2" class="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Time + duration -->
      <div
        v-if="activity.suggestedTime || activity.estimatedDurationMinutes"
        class="mt-2 flex flex-wrap items-center gap-2"
      >
        <span
          v-if="activity.suggestedTime"
          class="inline-flex items-center gap-1.5 rounded-full bg-terra-50 px-2.5 py-1 text-xs font-semibold text-terra-700"
        >
          <Icon name="lucide:clock" class="h-3 w-3" />
          {{ formatTime12h(activity.suggestedTime) }}
        </span>
        <span
          v-if="activity.estimatedDurationMinutes"
          class="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-[11px] font-semibold text-sand-700"
        >
          <Icon name="lucide:hourglass" class="h-3 w-3" />
          {{ formatDuration(activity.estimatedDurationMinutes) }}
        </span>
      </div>

      <p
        v-if="activity.description"
        class="mt-2 text-sm leading-relaxed text-sand-600 line-clamp-2"
      >
        {{ activity.description }}
      </p>

      <div v-if="tags.shown.length" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="tag in tags.shown"
          :key="tag"
          class="rounded-full bg-sand-100 px-2 py-0.5 text-[10px] text-sand-500"
        >
          {{ tag }}
        </span>
        <span
          v-if="tags.hidden"
          class="rounded-full px-1 py-0.5 text-[10px] text-sand-500"
          :title="activity.tags.slice(2).join(', ')"
          >+{{ tags.hidden }}</span
        >
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-sand-500">
        <a
          :href="getGoogleMapsUrl(activity)"
          target="_blank"
          rel="noopener noreferrer"
          class="-my-3 inline-flex min-w-0 max-w-full items-center gap-1.5 py-3 text-ocean-600 transition hover:text-terra-600"
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
        <!-- Cost meta: estimate, Google's price level and a notes marker as
             one group, not three separate items competing for the row. -->
        <span
          v-if="
            activity.costEstimate ||
            (activity.priceLevel != null && activity.priceLevel > 0) ||
            activity.notes
          "
          class="inline-flex items-center gap-1.5"
        >
          <Icon v-if="activity.costEstimate" name="lucide:wallet" class="h-3.5 w-3.5" />
          <span v-if="activity.costEstimate">{{
            formatCurrency(activity.costEstimate, { compact: true })
          }}</span>
          <span
            v-if="activity.priceLevel != null && activity.priceLevel > 0"
            class="text-xs font-medium text-forest-600"
            :title="`Price level ${activity.priceLevel} of 4`"
            >{{ formatPriceLevel(activity.priceLevel) }}</span
          >
          <Icon
            v-if="activity.notes"
            name="lucide:sticky-note"
            class="h-3.5 w-3.5"
            aria-label="Has notes"
          />
        </span>
        <!-- `activity.actualCost` is deliberately NOT rendered here (#39). The
             expense summary derives an activity's actual spend from the
             expenses linked to it, and the two disagree — they were both on
             screen at once, with nothing to tell a user which was real. The
             derived figure wins: it is the one backed by rows someone actually
             entered. The column stays until a backfill PR turns each
             `actualCost` into a real expense row. -->
      </div>

      <!-- Participants. Assigning starts from the card's menu; this row only
           appears once someone is assigned or the picker is open. -->
      <div
        v-if="canAssign && ((participants?.length ?? 0) > 0 || showParticipantPicker)"
        ref="pickerWrapRef"
        class="mt-2 flex items-center gap-1.5"
        @click.stop
        @keydown.stop="onPickerKeydown"
      >
        <div class="flex -space-x-1.5">
          <span
            v-for="p in (participants ?? []).slice(0, 5)"
            :key="p.userId"
            class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-cta text-[8px] font-bold text-white"
            :title="p.name"
          >
            {{ getInitials(p.name) }}
          </span>
        </div>

        <!-- Participant picker dropdown -->
        <div
          v-if="showParticipantPicker && !readonly"
          role="group"
          aria-label="Assign people"
          class="absolute z-20 mt-1 w-48 rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
          style="top: 100%"
        >
          <button
            v-for="m in members"
            :key="m.userId"
            type="button"
            :aria-pressed="isParticipant(m.userId)"
            class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm transition hover:bg-sand-50 focus:bg-sand-50 focus:outline-none"
            @click.stop="
              () => {
                emit('toggleParticipant', activity.id, m.userId)
                showParticipantPicker = false
              }
            "
          >
            <span
              class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white"
              :class="isParticipant(m.userId) ? 'bg-terra-500' : 'bg-sand-400'"
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
        class="-mb-2 mt-2 flex items-center gap-1 border-t border-sand-100 pt-0.5"
        @click.stop
        @keydown.stop
      >
        <button
          type="button"
          class="-ml-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg text-xs transition hover:text-forest-600 focus-ring"
          :class="votes?.myVote === 'up' ? 'font-medium text-forest-600' : 'text-sand-500'"
          :aria-pressed="votes?.myVote === 'up'"
          :aria-label="`Vote for ${activity.name}`"
          @click="emit('vote', activity.id, 'up')"
        >
          <Icon name="lucide:thumbs-up" class="h-3.5 w-3.5" />
          <span v-if="votes?.upVotes" class="tabular-nums">{{ votes.upVotes }}</span>
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg text-xs transition hover:text-terra-600 focus-ring"
          :class="votes?.myVote === 'down' ? 'font-medium text-terra-600' : 'text-sand-500'"
          :aria-pressed="votes?.myVote === 'down'"
          :aria-label="`Vote against ${activity.name}`"
          @click="emit('vote', activity.id, 'down')"
        >
          <Icon name="lucide:thumbs-down" class="h-3.5 w-3.5" />
          <span v-if="votes?.downVotes" class="tabular-nums">{{ votes.downVotes }}</span>
        </button>
        <button
          type="button"
          class="-mr-2 ml-auto inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs transition hover:text-ocean-600 focus-ring"
          :class="commentsOpen ? 'text-ocean-600' : 'text-sand-500'"
          :aria-expanded="commentsOpen"
          :aria-controls="commentsOpen ? `activity-comments-${activity.id}` : undefined"
          @click="emit('showComments', activity.id)"
        >
          <Icon name="lucide:message-circle" class="h-3.5 w-3.5" />
          <span v-if="commentCount">{{ commentCount }}</span>
          <span v-else>Comments</span>
        </button>
      </div>
    </div>
  </div>
</template>
