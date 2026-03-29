<script setup lang="ts">
interface Member {
  id: string;
  userId: string | null;
  role: string;
  status: string;
  invitedEmail?: string | null;
  expiresAt?: string | null;
  user: { id: string; name: string; email: string; image: string | null } | null;
  createdAt: string;
}

const props = defineProps<{
  tripId: string;
  currentRole: string;
}>();

const emit = defineEmits<{
  changed: [];
}>();

const { data: members, refresh } = await useFetch<Member[]>(
  `/api/trips/${props.tripId}/members`
);

const activeMembers = computed(() => members.value?.filter((m) => m.status === "active") ?? []);
const pendingInvites = computed(() => members.value?.filter((m) => m.status === "pending") ?? []);

const inviteEmail = ref("");
const inviteRole = ref<"editor" | "viewer">("editor");
const showInvite = ref(false);
const inviteError = ref("");
const inviteLoading = ref(false);

const { confirm } = useConfirm();
const dayjs = useDayjs();

async function handleInvite() {
  if (!inviteEmail.value.trim()) return;
  inviteError.value = "";
  inviteLoading.value = true;
  try {
    await $fetch(`/api/trips/${props.tripId}/members/invite`, {
      method: "POST",
      body: { email: inviteEmail.value, role: inviteRole.value },
    });
    inviteEmail.value = "";
    showInvite.value = false;
    await refresh();
    emit("changed");
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } };
    inviteError.value = err.data?.message ?? "Failed to invite";
  } finally {
    inviteLoading.value = false;
  }
}

async function handleRemove(member: Member) {
  const name = member.user?.name || member.invitedEmail || "this member";
  const ok = await confirm({
    title: member.status === "pending" ? "Revoke invite" : "Remove member",
    message: member.status === "pending"
      ? `Revoke the invite sent to ${member.invitedEmail}?`
      : `Remove ${name} from this trip?`,
    confirmText: member.status === "pending" ? "Revoke" : "Remove",
    destructive: true,
  });
  if (!ok) return;

  try {
    await $fetch(`/api/trips/${props.tripId}/members/${member.id}`, {
      method: "DELETE",
    });
    await refresh();
    emit("changed");
  } catch (e: unknown) {
    console.error("Failed to remove member:", e);
  }
}

async function handleLeave() {
  const ok = await confirm({
    title: "Leave trip",
    message: "Are you sure you want to leave this trip? You'll lose access unless re-invited.",
    confirmText: "Leave",
    destructive: true,
  });
  if (!ok) return;

  try {
    await $fetch(`/api/trips/${props.tripId}/members/leave`, { method: "POST" });
    navigateTo("/dashboard");
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } };
    console.error("Failed to leave:", err.data?.message);
  }
}

async function handleChangeRole(memberId: string, newRole: string) {
  try {
    await $fetch(`/api/trips/${props.tripId}/members/${memberId}`, {
      method: "PUT",
      body: { role: newRole },
    });
    await refresh();
    emit("changed");
  } catch (e: unknown) {
    console.error("Failed to change role:", e);
  }
}

function formatExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "";
  const d = dayjs(expiresAt);
  if (d.isBefore(dayjs())) return "Expired";
  return `Expires ${d.format("MMM D")}`;
}

const roleBadgeClass: Record<string, string> = {
  owner: "bg-terra-50 text-terra-700",
  editor: "bg-ocean-50 text-ocean-700",
  viewer: "bg-sand-100 text-sand-700",
};
</script>

<template>
  <div class="rounded-2xl border border-sand-200 bg-white p-6">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-sand-900">Trip Members</h3>
      <button
        v-if="currentRole === 'owner' || currentRole === 'editor'"
        class="inline-flex items-center gap-1 rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600"
        @click="showInvite = !showInvite"
      >
        <Icon name="lucide:user-plus" class="h-3 w-3" />
        Invite
      </button>
    </div>

    <!-- Invite form -->
    <form v-if="showInvite" class="mt-4 space-y-3 border-b border-sand-100 pb-4" @submit.prevent="handleInvite">
      <div class="flex gap-2">
        <input
          v-model="inviteEmail"
          type="email"
          placeholder="Email address"
          required
          class="block flex-1 rounded-lg border border-sand-200 bg-sand-50/50 px-3 py-2 text-sm input-focus"
        />
        <select
          v-model="inviteRole"
          class="rounded-lg border border-sand-200 bg-sand-50/50 px-2 py-2 text-sm input-focus"
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <p v-if="inviteError" class="text-xs text-red-600">{{ inviteError }}</p>
      <button
        type="submit"
        :disabled="inviteLoading"
        class="rounded-lg bg-terra-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terra-600 disabled:opacity-50"
      >
        {{ inviteLoading ? "Sending..." : "Send invite" }}
      </button>
    </form>

    <!-- Active members -->
    <div class="mt-4 space-y-1">
      <div
        v-for="member in activeMembers"
        :key="member.id"
        class="flex items-center justify-between rounded-lg px-2 py-2"
      >
        <div class="flex items-center gap-2.5">
          <img
            v-if="member.user?.image"
            :src="member.user.image"
            :alt="member.user?.name || ''"
            class="h-7 w-7 rounded-full object-cover"
            referrerpolicy="no-referrer"
          />
          <div v-else class="flex h-7 w-7 items-center justify-center rounded-full bg-terra-100 text-xs font-semibold text-terra-700">
            {{ member.user?.name?.charAt(0)?.toUpperCase() || '?' }}
          </div>
          <div>
            <p class="text-sm font-medium text-sand-900">{{ member.user?.name || member.invitedEmail }}</p>
            <p class="text-xs text-sand-500">{{ member.user?.email || '' }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <select
            v-if="currentRole === 'owner' && member.role !== 'owner' && member.status === 'active'"
            :value="member.role"
            class="rounded-full border border-sand-200 bg-sand-50 px-2 py-0.5 text-xs font-medium text-sand-700"
            @change="handleChangeRole(member.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <span
            v-else
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="roleBadgeClass[member.role] || 'bg-sand-100 text-sand-700'"
          >
            {{ formatType(member.role) }}
          </span>
          <button
            v-if="currentRole === 'owner' && member.role !== 'owner'"
            class="rounded p-1 text-sand-300 transition hover:text-red-500"
            title="Remove"
            @click="handleRemove(member)"
          >
            <Icon name="lucide:x" class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Pending invites (owner only) -->
    <div v-if="pendingInvites.length > 0 && currentRole === 'owner'" class="mt-4 border-t border-sand-100 pt-4">
      <h4 class="text-xs font-medium uppercase tracking-wide text-sand-400">Pending Invites</h4>
      <div class="mt-2 space-y-1">
        <div
          v-for="invite in pendingInvites"
          :key="invite.id"
          class="flex items-center justify-between rounded-lg bg-sand-50 px-3 py-2"
        >
          <div class="flex items-center gap-2.5">
            <div class="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-sand-300">
              <Icon name="lucide:mail" class="h-3.5 w-3.5 text-sand-400" />
            </div>
            <div>
              <p class="text-sm text-sand-700">{{ invite.invitedEmail }}</p>
              <p class="text-xs text-sand-400">
                {{ formatType(invite.role) }} · {{ formatExpiry(invite.expiresAt) }}
              </p>
            </div>
          </div>
          <button
            class="rounded-lg border border-sand-200 px-2.5 py-1 text-xs font-medium text-sand-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            @click="handleRemove(invite)"
          >
            Revoke
          </button>
        </div>
      </div>
    </div>

    <!-- Leave trip (non-owners only) -->
    <div v-if="currentRole !== 'owner'" class="mt-4 border-t border-sand-100 pt-4">
      <button
        class="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
        @click="handleLeave"
      >
        <Icon name="lucide:log-out" class="h-3.5 w-3.5" />
        Leave trip
      </button>
    </div>
  </div>
</template>
