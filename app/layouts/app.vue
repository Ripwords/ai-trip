<script setup lang="ts">
import { authClient } from "../lib/auth-client";

const { data: session } = await authClient.useSession(useFetch);
const { cycle, modeIcon, modeLabel } = useDarkMode();

async function logout() {
  await authClient.signOut();
  navigateTo("/login");
}
</script>

<template>
  <div class="min-h-screen bg-sand-50">
    <header class="glass sticky top-0 z-50 border-b border-sand-200/50">
      <nav class="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <NuxtLink to="/dashboard" class="flex items-center gap-2">
          <img src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" />
          <span class="font-display text-lg text-sand-900">AI Trip</span>
        </NuxtLink>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 rounded-full bg-sand-100 px-3 py-1.5">
            <img
              v-if="session?.user?.image"
              :src="session.user.image"
              :alt="session.user.name || ''"
              class="h-6 w-6 rounded-full object-cover"
              referrerpolicy="no-referrer"
            />
            <div
              v-else
              class="flex h-6 w-6 items-center justify-center rounded-full bg-terra-100 text-xs font-semibold text-terra-700"
            >
              {{ session?.user?.name?.charAt(0)?.toUpperCase() || '?' }}
            </div>
            <span class="text-sm font-medium text-sand-700">
              {{ session?.user?.name }}
            </span>
          </div>
          <button
            class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
            :title="`Theme: ${modeLabel}`"
            @click="cycle"
          >
            <Icon :name="modeIcon" class="h-4 w-4" />
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-sand-500 transition hover:bg-sand-100 hover:text-sand-700"
            @click="logout"
          >
            Log out
          </button>
        </div>
      </nav>
    </header>
    <main class="mx-auto max-w-7xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>
