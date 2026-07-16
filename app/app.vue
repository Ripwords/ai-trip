<script setup lang="ts">
useHead({
  titleTemplate: "%s %separator %siteName",
  templateParams: {
    siteName: "AI Trip",
    separator: "·",
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
  <ClientOnly>
    <ToastHost />
  </ClientOnly>
  <!-- Service worker updates apply automatically (registerType: autoUpdate);
       no manual "Update available" prompt is needed. -->
</template>
