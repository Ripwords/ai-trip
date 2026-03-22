<script setup lang="ts">
import { authClient } from "../lib/auth-client";

const { data: session } = await authClient.useSession(useFetch);
const isLoggedIn = computed(() => !!session.value?.user);
</script>

<template>
  <div class="min-h-screen bg-sand-50">
    <header class="glass sticky top-0 z-50 border-b border-sand-200/50">
      <nav class="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <NuxtLink to="/" class="flex items-center gap-2">
          <img src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" />
          <span class="font-display text-lg text-sand-900">AI Trip</span>
        </NuxtLink>
        <div class="flex items-center gap-3">
          <template v-if="isLoggedIn">
            <NuxtLink
              to="/dashboard"
              class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-terra-600 hover:shadow-md"
            >
              Dashboard
            </NuxtLink>
          </template>
          <template v-else>
            <NuxtLink
              to="/login"
              class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-terra-600 hover:shadow-md"
            >
              Sign in
            </NuxtLink>
          </template>
        </div>
      </nav>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
