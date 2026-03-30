<script setup lang="ts">
interface Activity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  rating: string | null;
  priceLevel: number | null;
  suggestedTime: string | null;
  estimatedDurationMinutes: number | null;
  costEstimate: string | null;
  notes: string | null;
  actualCost: string | null;
  photos: string[];
  openingHours: string[] | null;
  tags: string[];
  sortOrder: number;
}

function formatPriceLevel(level: number): string {
  return "$".repeat(Math.min(level, 4));
}

function getGoogleMapsUrl(activity: Activity): string {
  // Use query_place_id for precise matching, with query as fallback display
  // The api=1 format works cross-platform (iOS, Android, web)
  if (activity.placeId && activity.lat && activity.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}&query_place_id=${activity.placeId}`;
  }
  if (activity.lat && activity.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}`;
  }
  if (activity.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name)}`;
}

interface Participant {
  userId: string;
  name: string;
  image: string | null;
}

interface Member {
  userId: string;
  user: { name: string; image: string | null };
}

const props = defineProps<{
  activity: Activity;
  index: number;
  highlighted?: boolean;
  readonly?: boolean;
  isCollaborative?: boolean;
  voteCount?: number;
  commentCount?: number;
  participants?: Participant[];
  members?: Member[];
}>();

const emit = defineEmits<{
  edit: [activity: Activity];
  delete: [activity: Activity];
  click: [activity: Activity];
  vote: [activityId: string, vote: "up" | "down"];
  showComments: [activityId: string];
  toggleParticipant: [activityId: string, userId: string];
}>();

const showParticipantPicker = ref(false);

function isParticipant(userId: string): boolean {
  return props.participants?.some((p) => p.userId === userId) ?? false;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
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
};

function getBadgeClass(type: string): string {
  return typeBadgeClasses[type] || "bg-sand-100 text-sand-700";
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function starFill(rating: string | null, position: number): "full" | "half" | "empty" {
  if (!rating) return "empty";
  const val = parseFloat(rating);
  if (position <= Math.floor(val)) return "full";
  if (position === Math.floor(val) + 1 && val % 1 >= 0.25) return "half";
  return "empty";
}
</script>

<template>
  <div
    class="group rounded-2xl border bg-white p-5 transition cursor-pointer hover:shadow-md"
    :class="highlighted ? 'border-terra-500 bg-terra-50 shadow-md' : 'border-sand-200 hover:border-sand-300'"
    @click="emit('click', activity)"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3 min-w-0">
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-terra-500 text-xs font-bold text-white"
        >
          {{ index + 1 }}
        </span>
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
            <span
              v-if="activity.estimatedDurationMinutes"
              class="text-sm text-sand-500"
            >
              {{ formatDuration(activity.estimatedDurationMinutes) }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="!readonly" class="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition">
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

    <div class="mt-3 flex flex-wrap items-center gap-3 text-sm text-sand-500">
      <a
        :href="getGoogleMapsUrl(activity)"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 truncate text-ocean-600 transition hover:text-terra-600"
        title="Open in Google Maps"
        @click.stop
      >
        <Icon name="lucide:map-pin" class="h-3.5 w-3.5 shrink-0" />
        <span v-if="activity.address" class="truncate underline decoration-ocean-300 underline-offset-2 hover:decoration-terra-400">{{ activity.address }}</span>
        <span v-else class="truncate underline decoration-ocean-300 underline-offset-2 hover:decoration-terra-400">View on map</span>
        <Icon name="lucide:external-link" class="h-3 w-3 shrink-0 opacity-50" />
      </a>
      <span v-if="activity.costEstimate" class="flex items-center gap-1">
        <Icon name="lucide:dollar-sign" class="h-3.5 w-3.5" />
        {{ parseFloat(activity.costEstimate).toFixed(0) }}
      </span>
      <span v-if="activity.priceLevel != null && activity.priceLevel > 0" class="text-xs font-medium text-forest-600">
        {{ formatPriceLevel(activity.priceLevel) }}
      </span>
      <span v-if="activity.actualCost" class="flex items-center gap-1 text-forest-600 font-medium">
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
          @click.stop="emit('toggleParticipant', activity.id, m.userId); showParticipantPicker = false"
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
    <div v-if="isCollaborative" class="mt-3 flex items-center gap-3 border-t border-sand-100 pt-2">
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
</template>
