<script setup lang="ts">
interface LogEntry {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  user: { id: string; name: string; image: string | null };
}

interface LogResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const props = defineProps<{
  tripId: string;
}>();

const page = ref(1);
const limit = 5;

const { data, refresh } = await useFetch<LogResponse>(
  () => `/api/trips/${props.tripId}/logs?page=${page.value}&limit=${limit}`
);

const logs = computed(() => data.value?.logs ?? []);
const totalPages = computed(() => data.value?.totalPages ?? 1);
const total = computed(() => data.value?.total ?? 0);

function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  refresh();
}

defineExpose({ refresh });

const dayjs = useDayjs();

function formatTime(date: string): string {
  return dayjs(date).format("MMM D, h:mm A");
}

const actionIcons: Record<string, string> = {
  ai_prompt: "lucide:sparkles",
  activity_added: "lucide:plus-circle",
  activity_removed: "lucide:minus-circle",
  expense_added: "lucide:wallet",
  member_invited: "lucide:user-plus",
  member_removed: "lucide:user-minus",
  member_joined: "lucide:user-check",
  trip_updated: "lucide:edit",
};

// Visible page numbers (max 5)
const visiblePages = computed(() => {
  const pages: number[] = [];
  const tp = totalPages.value;
  if (tp <= 5) {
    for (let i = 1; i <= tp; i++) pages.push(i);
  } else {
    let start = Math.max(1, page.value - 2);
    const end = Math.min(tp, start + 4);
    start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
  }
  return pages;
});
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-6">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-sand-900">Activity Log</h3>
      <span v-if="total > 0" class="text-xs text-sand-400">{{ total }} events</span>
    </div>

    <div v-if="logs.length" class="mt-4 space-y-3">
      <div
        v-for="log in logs"
        :key="log.id"
        class="flex items-start gap-3"
      >
        <img
          v-if="log.user.image"
          :src="log.user.image"
          :alt="log.user.name"
          class="mt-0.5 h-6 w-6 rounded-full object-cover"
          referrerpolicy="no-referrer"
        />
        <div v-else class="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-sand-100 text-xs font-semibold text-sand-600">
          {{ log.user.name?.charAt(0)?.toUpperCase() || '?' }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <Icon :name="actionIcons[log.action] || 'lucide:activity'" class="h-3.5 w-3.5 shrink-0 text-sand-400" />
            <span class="text-sm text-sand-800">
              <span class="font-medium">{{ log.user.name }}</span>
              {{ log.description }}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-sand-400">{{ formatTime(log.createdAt) }}</p>
        </div>
      </div>
    </div>

    <p v-else class="mt-4 text-center text-xs text-sand-400">No activity yet</p>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="mt-4 flex items-center justify-center gap-1 border-t border-sand-100 pt-4">
      <button
        :disabled="page <= 1"
        class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 disabled:opacity-30"
        @click="goToPage(page - 1)"
      >
        <Icon name="lucide:chevron-left" class="h-4 w-4" />
      </button>

      <button
        v-for="p in visiblePages"
        :key="p"
        class="h-8 w-8 rounded-lg text-xs font-medium transition"
        :class="p === page
          ? 'bg-terra-500 text-white'
          : 'text-sand-600 hover:bg-sand-100'"
        @click="goToPage(p)"
      >
        {{ p }}
      </button>

      <button
        :disabled="page >= totalPages"
        class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 disabled:opacity-30"
        @click="goToPage(page + 1)"
      >
        <Icon name="lucide:chevron-right" class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
