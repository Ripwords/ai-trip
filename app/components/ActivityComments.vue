<script setup lang="ts">
interface ActivityComment {
  id: string
  text: string
  createdAt: string
  user: { name: string; image: string | null } | null
}

const props = defineProps<{
  tripId: string
  activityId: string
}>()

const emit = defineEmits<{
  /** How many comments the thread holds, once known. */
  count: [activityId: string, count: number]
}>()

const toast = useToast()
const dayjs = useDayjs()
const inputId = useId()

// Loaded only when the thread is opened, never during SSR.
const {
  data: comments,
  status,
  refresh,
} = useLazyFetch<ActivityComment[]>(
  () => `/api/trips/${props.tripId}/activities/${props.activityId}/comments`,
  { server: false, default: () => [] },
)

watch(
  () => comments.value?.length,
  (n) => {
    if (status.value === "success" && n != null) emit("count", props.activityId, n)
  },
)

const draft = ref("")
const posting = ref(false)

async function post() {
  const text = draft.value.trim()
  if (!text || posting.value) return
  posting.value = true
  try {
    await $fetch(`/api/trips/${props.tripId}/activities/${props.activityId}/comments`, {
      method: "POST",
      body: { text },
    })
    draft.value = ""
    await refresh()
  } catch (e: unknown) {
    console.error("Failed to post comment:", e)
    toast.error("Couldn't post your comment. Please try again.")
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="mt-2 rounded-xl border border-sand-200 bg-white p-3">
    <p v-if="status === 'pending'" class="text-xs text-sand-500">Loading comments...</p>
    <p v-else-if="status === 'error'" class="text-xs text-red-700">
      Couldn't load comments.
      <button type="button" class="underline underline-offset-2" @click="refresh()">Retry</button>
    </p>
    <ul v-else-if="comments.length" class="space-y-2">
      <li v-for="c in comments" :key="c.id" class="text-sm">
        <p class="text-xs text-sand-500">
          <span class="font-medium text-sand-800">{{ c.user?.name ?? "Someone" }}</span>
          · {{ dayjs(c.createdAt).format("MMM D, h:mm A") }}
        </p>
        <p class="whitespace-pre-wrap break-words text-sand-700">{{ c.text }}</p>
      </li>
    </ul>
    <p v-else class="text-xs text-sand-500">No comments yet.</p>

    <form class="mt-2 flex items-end gap-2" @submit.prevent="post">
      <label :for="inputId" class="sr-only">Add a comment</label>
      <input
        :id="inputId"
        v-model="draft"
        type="text"
        maxlength="1000"
        placeholder="Add a comment..."
        class="block min-h-11 min-w-0 flex-1 rounded-lg border border-sand-300 px-3 text-sm input-focus"
      />
      <button
        type="submit"
        :disabled="posting || !draft.trim()"
        class="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-cta px-3 text-xs font-medium text-white hover:bg-cta-hover disabled:opacity-50"
      >
        {{ posting ? "Posting..." : "Post" }}
      </button>
    </form>
  </div>
</template>
