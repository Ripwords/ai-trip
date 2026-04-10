<script setup lang="ts">
import { authClient } from "../lib/auth-client";

const { data: session } = await authClient.useSession(useFetch);
const { cycle, modeIcon, modeLabel } = useDarkMode();

const showUserMenu = ref(false);
const menuRef = ref<HTMLElement | null>(null);

async function logout() {
  await authClient.signOut();
  navigateTo("/login");
}

// Close on click outside
function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    showUserMenu.value = false;
  }
}

onMounted(() => document.addEventListener("click", handleClickOutside));
onUnmounted(() => document.removeEventListener("click", handleClickOutside));
</script>

<template>
  <div class="min-h-screen bg-sand-50">
    <header class="glass sticky top-0 z-50 border-b border-sand-200/50">
      <nav class="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <NuxtLink to="/dashboard" class="flex items-center gap-2">
          <img src="/image.png" alt="AI Trip" class="h-8 w-8 rounded-lg" />
          <span class="font-display text-lg text-sand-900">AI Trip</span>
        </NuxtLink>
        <div class="flex items-center gap-2">
          <NuxtLink
            v-if="(session?.user as Record<string, unknown>)?.role === 'admin'"
            to="/admin"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
            title="Admin"
          >
            <Icon name="lucide:shield" class="h-4 w-4" />
          </NuxtLink>
          <NuxtLink
            to="/explore"
            class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sand-500 transition hover:bg-sand-100 hover:text-sand-700 dark:text-sand-400 dark:hover:bg-sand-800 dark:hover:text-sand-200"
            active-class="bg-sand-100 text-sand-900 dark:bg-sand-800 dark:text-sand-100"
          >
            <Icon name="lucide:globe" class="h-4 w-4" />
            <span class="hidden sm:inline">Explore</span>
          </NuxtLink>
          <ClientOnly>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-lg text-sand-400 transition hover:bg-sand-100 hover:text-sand-700"
              :title="`Theme: ${modeLabel}`"
              @click="cycle"
            >
              <Icon :name="modeIcon" class="h-4 w-4" />
            </button>
          </ClientOnly>

          <!-- User pill with dropdown -->
          <div ref="menuRef" class="relative">
            <button
              class="flex items-center gap-2 rounded-full bg-sand-100 px-3 py-1.5 transition hover:bg-sand-200"
              @click.stop="showUserMenu = !showUserMenu"
            >
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
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <slot />
    </main>
  </div>
</template>
