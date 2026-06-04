<script setup lang="ts">
const { $pwa } = useNuxtApp()

useHead({
  titleTemplate: "%s %separator %siteName",
  templateParams: {
    siteName: "AI Trip",
    separator: "—",
  },
})

useSeoMeta({
  ogType: "website",
  ogSiteName: "AI Trip",
  twitterCard: "summary_large_image",
})
</script>

<template>
  <VitePwaManifest />
  <NuxtPwaAssets />
  <AppSplashScreen />
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ClientOnly>
    <ConfirmDialog />
  </ClientOnly>

  <!-- PWA update prompt -->
  <ClientOnly>
    <div
      v-if="$pwa?.needRefresh"
      class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-sand-200 bg-white px-4 py-3 shadow-lg"
    >
      <Icon name="lucide:refresh-cw" class="h-4 w-4 text-terra-500" />
      <span class="text-sm text-sand-700">Update available</span>
      <button
        class="rounded-lg bg-terra-500 px-3 py-1 text-xs font-medium text-white hover:bg-terra-600"
        @click="$pwa?.updateServiceWorker()"
      >
        Reload
      </button>
      <button class="text-xs text-sand-400 hover:text-sand-600" @click="$pwa?.cancelPrompt()">
        Later
      </button>
    </div>
  </ClientOnly>
</template>
