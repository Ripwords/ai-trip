<script setup lang="ts">
import { authClient } from "../lib/auth-client"

const { data: session } = await authClient.useSession(useFetch)
const isLoggedIn = computed(() => !!session.value?.user)
const { cycle, modeIcon, modeLabel } = useDarkMode()

const signInPending = ref(false)

function signInWithGoogle() {
  signInPending.value = true
  authClient.signIn.social({
    provider: "google",
    callbackURL: "/dashboard",
    errorCallbackURL: "/",
  })
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-sand-50">
    <header class="glass sticky top-0 z-50 border-b border-sand-200/50">
      <nav class="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <NuxtLink to="/" class="flex items-center gap-2">
          <NuxtImg src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" loading="eager" />
          <span class="font-display text-lg text-sand-900">AI Trip</span>
        </NuxtLink>
        <div class="flex items-center gap-3">
          <ClientOnly>
            <button
              type="button"
              class="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sand-500 transition hover:bg-sand-100 hover:text-sand-700"
              :title="`Theme: ${modeLabel}`"
              :aria-label="`Theme: ${modeLabel}`"
              @click="cycle"
            >
              <Icon :name="modeIcon" class="h-4 w-4" />
            </button>
          </ClientOnly>
          <ClientOnly>
            <NuxtLink
              v-if="isLoggedIn"
              to="/dashboard"
              class="focus-ring rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-terra-600 hover:shadow-md"
            >
              Dashboard
            </NuxtLink>
            <button
              v-else
              type="button"
              :disabled="signInPending"
              class="focus-ring flex items-center gap-2 rounded-xl bg-terra-500 px-5 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-terra-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
              @click="signInWithGoogle"
            >
              <Icon
                v-if="signInPending"
                name="lucide:loader"
                class="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
              <svg v-else class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#fff"
                  opacity="0.95"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#fff"
                  opacity="0.85"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#fff"
                  opacity="0.75"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#fff"
                />
              </svg>
              {{ signInPending ? "Redirecting..." : "Sign in with Google" }}
            </button>
            <template #fallback>
              <span
                class="rounded-xl bg-terra-500/60 px-5 py-2 text-sm font-medium text-white shadow-sm"
                aria-hidden="true"
              >
                &nbsp;
              </span>
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
