<script setup lang="ts">
import { authClient } from "../lib/auth-client";

useHead({ title: "AI Trip — Plan your trip with AI" });

const { data: session } = await authClient.useSession(useFetch);
const isLoggedIn = computed(() => !!session.value?.user);
</script>

<template>
  <div class="relative min-h-[90vh] overflow-hidden bg-sand-50">
    <!-- Ambient gradient orbs -->
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute -right-32 -top-32 h-[500px] w-[500px] rounded-full bg-terra-200/30 blur-[120px]" />
      <div class="absolute -left-20 top-1/3 h-[400px] w-[400px] rounded-full bg-ocean-200/20 blur-[100px]" />
      <div class="absolute -bottom-20 right-1/4 h-[350px] w-[350px] rounded-full bg-forest-200/15 blur-[100px]" />
    </div>

    <!-- Grid pattern overlay -->
    <div
      class="pointer-events-none absolute inset-0 opacity-[0.03]"
      style="background-image: radial-gradient(circle, #3d3328 1px, transparent 1px); background-size: 32px 32px;"
      aria-hidden="true"
    />

    <div class="relative z-10 flex flex-col items-center justify-center px-6 py-28 text-center sm:py-36">
      <!-- Eyebrow -->
      <div class="inline-flex items-center gap-2 rounded-full border border-terra-200 bg-white/60 px-4 py-1.5 backdrop-blur-sm">
        <span class="h-1.5 w-1.5 rounded-full bg-terra-500 animate-pulse" />
        <span class="text-xs font-medium tracking-wide text-terra-700">AI-Powered Travel Planning</span>
      </div>

      <!-- Main heading -->
      <h1 class="mt-8 font-display text-5xl leading-[1.1] tracking-tight text-sand-900 sm:text-7xl lg:text-8xl">
        Plan trips that<br>
        <span class="text-gradient">feel local</span>
      </h1>

      <!-- Subheading -->
      <p class="mx-auto mt-6 max-w-lg text-base leading-relaxed text-sand-600 sm:text-lg">
        AI finds hidden gems and real places verified by Google Maps.
        No tourist traps — just authentic, editable itineraries.
      </p>

      <!-- CTA -->
      <div class="mt-10 flex items-center gap-4">
        <template v-if="isLoggedIn">
          <NuxtLink
            to="/dashboard"
            class="group relative overflow-hidden rounded-xl bg-terra-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-terra-500/25 transition-all hover:bg-terra-600 hover:shadow-xl hover:shadow-terra-500/30"
          >
            <span class="relative z-10">Go to Dashboard</span>
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink
            to="/login"
            class="group relative overflow-hidden rounded-xl bg-terra-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-terra-500/25 transition-all hover:bg-terra-600 hover:shadow-xl hover:shadow-terra-500/30"
          >
            <span class="relative z-10">Get started free</span>
          </NuxtLink>
        </template>
      </div>

      <!-- Feature pills -->
      <div class="mt-16 flex flex-wrap items-center justify-center gap-3">
        <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60">
          <Icon name="lucide:map-pin" class="h-3.5 w-3.5 text-terra-500" />
          Google Maps verified
        </div>
        <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60">
          <Icon name="lucide:sparkles" class="h-3.5 w-3.5 text-terra-500" />
          AI-powered suggestions
        </div>
        <div class="flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-sand-700 backdrop-blur-sm border border-sand-200/60">
          <Icon name="lucide:heart" class="h-3.5 w-3.5 text-terra-500" />
          Local favorites first
        </div>
      </div>
    </div>
  </div>
</template>
