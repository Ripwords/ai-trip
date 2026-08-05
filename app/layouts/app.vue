<script setup lang="ts">
import { authClient } from "../lib/auth-client"

const { data: session } = await authClient.useSession(useFetch)
const { cycle, modeIcon, modeLabel } = useDarkMode()

const showUserMenu = ref(false)
const menuRef = ref<HTMLElement | null>(null)

async function logout() {
  try {
    await authClient.signOut()
  } catch {
    // Sign-out may fail if session already expired — redirect anyway
  }
  await navigateTo("/?logout=1", { external: true })
}

// Close on click outside
function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    showUserMenu.value = false
  }
}

// Close on Escape
function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && showUserMenu.value) {
    showUserMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside)
  document.addEventListener("keydown", handleEscape)
})
onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside)
  document.removeEventListener("keydown", handleEscape)
})
</script>

<template>
  <div class="min-h-dvh bg-sand-50">
    <header class="glass sticky top-0 z-50 border-b border-sand-200/50">
      <nav class="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <NuxtLink to="/dashboard" class="flex min-h-11 items-center gap-2">
          <NuxtImg src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" loading="eager" />
          <span class="font-display text-lg text-sand-900">AI Trip</span>
        </NuxtLink>
        <div class="flex items-center gap-2">
          <NuxtLink
            v-if="(session?.user as Record<string, unknown>)?.role === 'admin'"
            to="/admin"
            class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 focus-ring"
            aria-label="Admin"
            title="Admin"
          >
            <Icon name="lucide:shield" class="h-4 w-4" />
          </NuxtLink>
          <NuxtLink
            to="/explore"
            class="hidden min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 focus-ring sm:inline-flex dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
            active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
          >
            <Icon name="lucide:globe" class="h-4 w-4" />
            <span>Explore</span>
          </NuxtLink>
          <NuxtLink
            to="/flights"
            class="hidden min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 focus-ring sm:inline-flex dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
            active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
          >
            <Icon name="lucide:plane" class="h-4 w-4" />
            <span>Flights</span>
          </NuxtLink>
          <NuxtLink
            to="/passport"
            class="hidden min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 focus-ring sm:inline-flex dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
            active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
          >
            <Icon name="lucide:stamp" class="h-4 w-4" />
            <span>Passport</span>
          </NuxtLink>
          <ClientOnly>
            <button
              type="button"
              class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-sand-400 transition hover:bg-sand-100 hover:text-sand-700 focus-ring"
              :aria-label="`Theme: ${modeLabel}`"
              :title="`Theme: ${modeLabel}`"
              @click="cycle"
            >
              <Icon :name="modeIcon" class="h-4 w-4" />
            </button>
          </ClientOnly>

          <!-- User pill with dropdown -->
          <div ref="menuRef" class="relative">
            <button
              type="button"
              class="flex min-h-11 items-center gap-2 rounded-full bg-sand-100 px-3 py-1.5 transition hover:bg-sand-200 focus-ring"
              aria-haspopup="menu"
              :aria-expanded="showUserMenu"
              aria-label="Account menu"
              @click.stop="showUserMenu = !showUserMenu"
            >
              <ClientOnly>
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
                  {{ session?.user?.name?.charAt(0)?.toUpperCase() || "?" }}
                </div>
                <template #fallback>
                  <div class="h-6 w-6 rounded-full bg-sand-200" />
                </template>
              </ClientOnly>
              <span class="hidden text-sm font-medium text-sand-700 sm:inline">
                {{ session?.user?.name }}
              </span>
              <Icon
                name="lucide:chevron-down"
                class="h-3 w-3 text-sand-400 transition-transform"
                :class="{ 'rotate-180': showUserMenu }"
              />
            </button>

            <!-- Dropdown -->
            <Transition
              enter-active-class="duration-150 ease-out"
              enter-from-class="scale-95 opacity-0"
              enter-to-class="scale-100 opacity-100"
              leave-active-class="duration-100 ease-in"
              leave-from-class="scale-100 opacity-100"
              leave-to-class="scale-95 opacity-0"
            >
              <div
                v-if="showUserMenu"
                class="absolute right-0 top-full mt-2 w-56 origin-top-right rounded-xl border border-sand-200 bg-white p-1.5 shadow-lg"
              >
                <!-- User info -->
                <div class="px-3 py-2">
                  <p class="text-sm font-medium text-sand-900">{{ session?.user?.name }}</p>
                  <p class="text-xs text-sand-500">{{ session?.user?.email }}</p>
                </div>

                <div class="my-1 border-t border-sand-100" />

                <!-- Menu items -->
                <NuxtLink
                  to="/dashboard"
                  class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-50"
                  @click="showUserMenu = false"
                >
                  <Icon name="lucide:layout-dashboard" class="h-4 w-4 text-sand-400" />
                  Dashboard
                </NuxtLink>
                <NuxtLink
                  to="/settings"
                  class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-sand-700 transition hover:bg-sand-50"
                  @click="showUserMenu = false"
                >
                  <Icon name="lucide:settings" class="h-4 w-4 text-sand-400" />
                  Settings
                </NuxtLink>

                <div class="my-1 border-t border-sand-100" />

                <button
                  class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
                  @click="logout"
                >
                  <Icon name="lucide:log-out" class="h-4 w-4" />
                  Log out
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </nav>
    </header>
    <main class="app-main mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <slot />
    </main>
    <NavMobile />
  </div>
</template>

<style scoped>
/* On mobile, pad bottom to clear the fixed tab bar + safe area */
@media (max-width: 639px) {
  .app-main {
    padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
  }
}
</style>
