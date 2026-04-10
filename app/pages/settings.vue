<script setup lang="ts">
definePageMeta({ layout: "app" });
useSeoMeta({
  title: "Settings",
  description: "Manage your AI Trip account settings and preferences.",
});

import { authClient } from "../lib/auth-client";
const { data: session } = await authClient.useSession(useFetch);
const { data: aiUsage } = await useFetch<{
  used: number;
  limit: number;
  remaining: number;
}>("/api/ai/usage");

const { data: profile, refresh: refreshProfile } = await useFetch("/api/user/profile");
const nationality = ref<string | null>(profile.value?.nationality ?? null);
const savingNationality = ref(false);
const nationalityInitialized = ref(false);

async function saveNationality() {
  savingNationality.value = true;
  try {
    await $fetch("/api/user/profile", {
      method: "PUT",
      body: { nationality: nationality.value },
    });
    await refreshProfile();
  } catch (e: unknown) {
    console.error("Failed to save nationality:", e);
  } finally {
    savingNationality.value = false;
  }
}

watch(nationality, () => {
  // Skip the first change (initialization from profile)
  if (!nationalityInitialized.value) {
    nationalityInitialized.value = true;
    return;
  }
  saveNationality();
});

const { mode, setMode } = useDarkMode();

const modeLabels: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const modeIcons: Record<string, string> = {
  light: "lucide:sun",
  dark: "lucide:moon",
  system: "lucide:monitor",
};
</script>

<template>
  <div class="mx-auto max-w-lg space-y-6">
    <h1 class="font-display text-2xl text-sand-900">Settings</h1>

    <!-- Profile -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-sand-900">Profile</h2>
      <div v-if="session?.user" class="mt-4 flex items-center gap-4">
        <img
          v-if="session.user.image"
          :src="session.user.image"
          :alt="session.user.name"
          class="h-14 w-14 rounded-full"
        />
        <div
          v-else
          class="flex h-14 w-14 items-center justify-center rounded-full bg-terra-100 text-lg font-bold text-terra-600"
        >
          {{ session.user.name?.charAt(0) ?? "?" }}
        </div>
        <div>
          <p class="font-medium text-sand-900">{{ session.user.name }}</p>
          <p class="text-sm text-sand-500">{{ session.user.email }}</p>
        </div>
      </div>
    </div>

    <!-- Nationality / Passport -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-sand-900">Passport Nationality</h2>
      <p class="mt-1 text-xs text-sand-500">Used for visa requirement checks</p>
      <div class="mt-4">
        <NationalitySelector v-model="nationality" />
      </div>
    </div>

    <!-- AI Usage -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-sand-900">AI Usage</h2>
      <div v-if="aiUsage" class="mt-4">
        <div class="flex items-baseline justify-between">
          <p class="text-sm text-sand-600">
            <span class="font-semibold text-sand-900">{{ aiUsage.used }}</span> / {{ aiUsage.limit }} prompts used
          </p>
          <p class="text-xs text-sand-400">Resets monthly</p>
        </div>
        <div class="mt-2 h-2 w-full rounded-full bg-sand-200">
          <div
            class="h-2 rounded-full bg-terra-500 transition-all"
            :style="{ width: `${Math.min((aiUsage.used / aiUsage.limit) * 100, 100)}%` }"
          />
        </div>
        <p class="mt-1 text-xs text-sand-500">{{ aiUsage.remaining }} remaining</p>
      </div>
    </div>

    <!-- Theme -->
    <div class="rounded-2xl border border-sand-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-sand-900">Theme</h2>
      <div class="mt-4 flex gap-2">
        <button
          v-for="m in ['light', 'dark', 'system']"
          :key="m"
          class="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition"
          :class="mode === m
            ? 'border-terra-400 bg-terra-50 text-terra-700'
            : 'border-sand-200 text-sand-600 hover:border-sand-300'"
          @click="setMode(m as 'light' | 'dark' | 'system')"
        >
          <Icon :name="modeIcons[m] ?? 'lucide:sun'" class="h-4 w-4" />
          {{ modeLabels[m] }}
        </button>
      </div>
    </div>
  </div>
</template>
