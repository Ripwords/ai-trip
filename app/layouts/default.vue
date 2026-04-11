<script setup lang="ts">
import { authClient } from "../lib/auth-client"

const { data: session } = await authClient.useSession(useFetch)
const isLoggedIn = computed(() => !!session.value?.user)
const { cycle, modeIcon, modeLabel } = useDarkMode()
</script>

<template>
  <div class="flex min-h-screen flex-col bg-sand-50">
    <header class="glass sticky top-0 z-50 border-b border-sand-200/50">
      <nav class="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <NuxtLink to="/" class="flex items-center gap-2">
          <img src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" />
          <span class="font-display text-lg text-sand-900">AI Trip</span>
        </NuxtLink>
        <div class="flex items-center gap-3">
          <ClientOnly>
            <button
              class="rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
              :title="`Theme: ${modeLabel}`"
              @click="cycle"
            >
              <Icon :name="modeIcon" class="h-4 w-4" />
            </button>
          </ClientOnly>
          <ClientOnly>
            <NuxtLink
              :to="isLoggedIn ? '/dashboard' : '/login'"
              class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-terra-600 hover:shadow-md"
            >
              {{ isLoggedIn ? "Dashboard" : "Sign in" }}
            </NuxtLink>
            <template #fallback>
              <NuxtLink
                to="/login"
                class="rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-terra-600 hover:shadow-md"
              >
                Sign in
              </NuxtLink>
            </template>
          </ClientOnly>
        </div>
      </nav>
    </header>
    <main class="flex-1">
      <slot />
    </main>
    <footer class="border-t border-sand-200/50 py-6 text-center text-xs text-sand-400">
      <div class="mx-auto max-w-7xl px-6">
        &copy; {{ new Date().getFullYear() }} AI Trip. AI-powered travel planning with Google Maps
        verified places.
      </div>
    </footer>
  </div>
</template>
